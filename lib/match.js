import {ok} from 'node:assert'
import {cpus as osCpus} from 'node:os'
import {
	Gauge,
	Counter,
	Summary,
} from 'prom-client'
import {
	asyncConsume,
	execPipe,
	asyncMap,
	asyncBuffer,
} from 'iter-tools'
import {createLogger} from './logger.js'
import {register} from './metrics.js'
import {
	AckPolicy as NatsAckPolicy,
	jsonCodec as natsJson,
} from './nats.js'
import {
	createMatchWithGtfs,
} from './raw-match.js'
import {withSoftExit} from './soft-exit.js'
import {MAJOR_VERSION} from './major-version.js'
import {
	TOPIC_BASE_PREFIX as GTFS_RT_TOPIC_PREFIX,
	getNatsTopicFromGtfsRtTripUpdate,
} from './gtfs-rt-mqtt-topics.js'

// selected from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects#error_objects
const PROGRAMMER_ERRORS = [
	RangeError,
	ReferenceError,
	SyntaxError,
	TypeError,
	URIError,
]
const isProgrammerError = (err) => {
	// todo: use `PROGRAMMER_ERRORS.includes(err.__proto__.constructor)`?
	return PROGRAMMER_ERRORS.some(Err => err instanceof Err)
}

// todo: DRY with OpenDataVBB/nats-consuming-gtfs-rt-server
const NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME = `AUS_ISTFAHRT_${MAJOR_VERSION}`
const NATS_JETSTREAM_GTFSRT_STREAM_NAME = `GTFS_RT_${MAJOR_VERSION}`

// https://github.com/derhuerst/vdv-453-nats-adapter/blob/d13427fb759f996aa7cba61f1ec0a0da828a0e4b/index.js#L109
// todo: DRY with OpenDataVBB/nats-consuming-gtfs-rt-server
const AUS_ISTFAHRT_TOPIC_PREFIX = 'aus.istfahrt.'

const logger = createLogger('match')

const abortWithError = (err) => {
	logger.error(err)
	process.exit(1)
}

const runGtfsMatching = async (cfg, opt = {}) => {
	const {
		logger: serviceLogger,
		natsClient,
		natsJetstreamClient,
		natsJetstreamManager,
	} = cfg
	ok(serviceLogger)
	ok(natsClient)
	ok(natsJetstreamClient)
	ok(natsJetstreamManager)

	const {
		natsConsumerDurableName,
		matchConcurrency,
	} = {
		natsConsumerDurableName: process.env.MATCHING_CONSUMER_DURABLE_NAME
			? process.env.MATCHING_CONSUMER_DURABLE_NAME
			: NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME + '_' + Math.random().toString(16).slice(2, 6),
		matchConcurrency: process.env.MATCHING_CONCURRENCY
			? parseInt(process.env.MATCHING_CONCURRENCY)
			// this makes assumptions about how PostgreSQL scales
			// todo: query the *PostgreSQL server's* nr of cores, instead of the machine's that hafas-gtfs-rt-feed runs on
			// todo: match-gtfs-rt-to-gtfs uses pg.Pool, which has a max connection limit, so this option here is a bit useless...
			// but it seems there's no clean way to determine this
			//     CREATE TEMPORARY TABLE cpu_cores (num_cores integer);
			//     COPY cpu_cores (num_cores) FROM PROGRAM 'sysctl -n hw.ncpu';
			//     SELECT num_cores FROM cpu_cores LIMIT 1
			// same as with hafas-gtfs-rt-feed: https://github.com/derhuerst/hafas-gtfs-rt-feed/blob/8.2.6/lib/match.js#L54-L61
			: osCpus().length + 1,
		...opt,
	}

	const natsMsgSeq = new Gauge({
		name: 'nats_msg_seq',
		help: 'sequence number of the latest NATS message being processed',
		registers: [register],
	})
	const successesTotal = new Counter({
		name: 'matching_successes_total',
		help: 'number of successfully matched movements/trips',
		registers: [register],
		labelNames: [
			'cached',
		],
	})
	const failuresTotal = new Counter({
		name: 'matching_failures_total',
		help: 'number of matching failures',
		registers: [register],
		labelNames: [],
	})
	const errorsTotal = new Counter({
		name: 'matching_errors_total',
		help: 'number of errors that have occured while matching',
		registers: [register],
		labelNames: [],
	})
	const matchingTimeSeconds = new Summary({
		name: 'matching_time_seconds',
		help: 'seconds trips need to be matched',
		registers: [register],
		labelNames: [
			'matched',
			'cached',
		],
	})

	const {
		matchVdvAusIstFahrtWithGtfs,
		stop: stopMatching,
	} = await createMatchWithGtfs({
		logger,
	})

	const matchVdvAusIstFahrtAndPublishAsGtfsRtTripUpdate = async (vdvAusIstFahrt, msg) => {
		try {
			const {
				item: gtfsRtTripUpdate,
				isMatched,
				isCached,
				matchingTime,
			} = await matchVdvAusIstFahrtWithGtfs(vdvAusIstFahrt)

			const topic = getNatsTopicFromGtfsRtTripUpdate(gtfsRtTripUpdate)

			logger.trace({
				topic,
				isMatched,
				isCached,
				matchingTime,
				gtfsRtTripUpdate,
				// todo: log just a slice?
				vdvAusIstFahrt,
				natsMsgSeq: msg.seq,
			}, 'publishing GTFS-RT TripUpdate')
			natsClient.publish(topic, natsJson.encode(gtfsRtTripUpdate))

			if (isMatched) {
				successesTotal.inc({
					cached: isCached ? '1' : '0',
				})
			} else {
				failuresTotal.inc()
			}
			matchingTimeSeconds.observe({
				matched: isMatched ? '1' : '0',
				cached: isCached ? '1' : '0',
			}, matchingTime / 1000)
		} catch (err) {
			if (isProgrammerError(err)) {
				throw err
			}
			logger.warn({
				err,
				vdvAusIstFahrt,
				natsMsgSeq: msg.seq,
			}, `failed to match trip: ${err.message || (err + '')}`)
			errorsTotal.inc()
		}
	}

	const processAusIstFahrtMsg = async (msg) => {
		const {
			subject,
			seq,
			redelivered,
			data,
		} = msg
		serviceLogger.debug({
			subject,
			seq,
			redelivered,
			dataSlice: data.slice(0, 100).toString('utf8'),
		}, 'processing AUS IstFahrt msg')
		natsMsgSeq.set(seq) // todo: is `seq` an integer?

		let ausIstFahrt = null
		try {
			ausIstFahrt = msg.json(data)
		} catch (err) {
			serviceLogger.warn({
				err,
				subject,
				seq,
			}, 'failure decoding AUS IstFahrt msg')
			// We don't nak() here because we don't want it to be redelivered, the message is invalid anyways.
			return;
		}

		try {
			// todo: validate against schema, error-log and abort if invalid
			await matchVdvAusIstFahrtAndPublishAsGtfsRtTripUpdate(ausIstFahrt, msg)

			serviceLogger.trace({
				subject,
				seq,
			}, 'successfully processed AUS IstFahrt msg')
			msg.ack()
		} catch (err) {
			// We catch all non-programmer errors in order not to abort the message processing (see below).
			serviceLogger.warn({
				err,
				subject,
				seq,
			}, 'failure processing AUS IstFahrt msg')
			// Explicitly signal to NATS JetStream that this message could not be processed.
			msg.nak()
			if (isProgrammerError(err)) {
				throw err
			}
		}
	}

	{
		// todo: shouldn't this be done upfront by the person deploying the service?
		{
			// create/update NATS JetStream stream for AUS IstFahrts
			const streamInfo = await natsJetstreamManager.streams.add({
				name: NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME,
				subjects: [
					AUS_ISTFAHRT_TOPIC_PREFIX + '>',
				],
				// todo: limits?
			})
			serviceLogger.debug({
				streamInfo,
			}, 'created/re-used NATS JetStream stream for AUS IstFahrts')
		}
		{
			// create/update NATS JetStream stream for GTFS-RT data
			const streamInfo = await natsJetstreamManager.streams.add({
				name: NATS_JETSTREAM_GTFSRT_STREAM_NAME,
				subjects: [
					GTFS_RT_TOPIC_PREFIX + '>',
				],
				// todo: limits?
			})
			serviceLogger.debug({
				streamInfo,
			}, 'created/re-used NATS JetStream stream for GTFS-RT data')
		}

		// create durable NATS JetStream consumer for previously created stream
		const consumerInfo = await natsJetstreamManager.consumers.add(NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME, {
			ack_policy: NatsAckPolicy.Explicit,
			durable_name: natsConsumerDurableName,
			// todo: configure inactive_threshold?
			// todo: set max_ack_pending to 1 for strict ordering of messages?
			// todo: configure ack_wait?

			// todo: https://nats-io.github.io/nats.deno/interfaces/ConsumerConfig.html ?

			// todo: add trip ID to topic, consume with `DeliverLastPerSubject`? – would not work for partial IstFahrts
		})
		serviceLogger.debug({
			consumerInfo,
		}, 'created/re-used NATS JetStream consumer')

		const tripsConsumer = await natsJetstreamClient.consumers.get(NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME, consumerInfo.name)
		const tripsSub = await tripsConsumer.consume()
		execPipe(
			tripsSub,

			// asyncBuffer workaround
			// see also https://github.com/iter-tools/iter-tools/issues/425#issuecomment-882875848
			asyncMap(msg => [processAusIstFahrtMsg(msg)]),
			asyncBuffer(matchConcurrency),
			asyncMap(([task]) => task),

			asyncConsume,
		).catch(abortWithError)

		// todo: support IstUmlauf – would require adapting vdv-453-nats-adapter
	}

	withSoftExit(() => {
		stopMatching().catch(abortWithError)
		// todo: close nats consumers
	})
}

export {
	runGtfsMatching,
}
