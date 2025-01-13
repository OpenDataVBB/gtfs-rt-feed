import {ok} from 'node:assert'
import {cpus as osCpus} from 'node:os'
import {
	Gauge,
	Counter,
	Summary,
} from 'prom-client'
import {
	asyncConsume,
} from 'iter-tools'
import {
	mapConcurrent as mapConcurrently,
} from 'async-iterator-concurrent-map'
import {createLogger} from './logger.js'
import {register} from './metrics.js'
import {
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

const logger = createLogger('match', {
	level: (process.env.LOG_LEVEL_MATCHING || 'warn').toLowerCase(),
})

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
		natsConsumerName,
		natsAckWait, // in milliseconds
		matchConcurrency,
		publishUnmatchedTripUpdates,
	} = {
		natsConsumerName: process.env.MATCHING_CONSUMER_NAME
			? process.env.MATCHING_CONSUMER_NAME
			: 'gtfs-rt-feed',
		natsAckWait: 60 * 1000, // 60 seconds
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
		publishUnmatchedTripUpdates: process.env.MATCHING_PUBLISH_UNMATCHED_TRIPUPDATES
			? process.env.MATCHING_PUBLISH_UNMATCHED_TRIPUPDATES === 'true'
			: false,
		...opt,
	}
	ok(Number.isInteger(natsAckWait), 'opt.natsAckWait must be an integer')

	// NATS-related metrics
	// Note: We mirror OpenDataVBB/gtfs-rt-feed's metrics here.
	const natsNrOfMessagesReceivedTotal = new Counter({
		name: 'nats_nr_of_msgs_received_total',
		help: 'number of messages received from NATS',
		registers: [register],
		labelNames: [
			'stream', // name of the JetStream stream
			'consumer', // name of the JetStream consumer
			'topic_root', // first "segment" of the topic, e.g. `AUS` with `aus.istfahrt.foo.bar`
			'redelivered', // 1/0
		],
	})
	const natsLatestMessageReceivedTimestampSeconds = new Gauge({
		name: 'nats_latest_msg_received_timestamp_seconds',
		help: 'when the latest message has been received from NATS',
		registers: [register],
		labelNames: [
			'stream', // name of the JetStream stream
			'consumer', // name of the JetStream consumer
			'topic_root', // first "segment" of the topic, e.g. `AUS` with `aus.istfahrt.foo.bar`
			'redelivered', // 1/0
		],
	})
	// todo: track redeliveries as `Summary` using `msg.info.redeliveryCount`
	const natsNrOfMessagesSentTotal = new Counter({
		name: 'nats_nr_of_msgs_sent_total',
		help: 'number of messages sent to NATS',
		registers: [register],
		labelNames: [
			'topic_root', // first "segment" of the topic, e.g. `AUS` with `aus.istfahrt.foo.bar`
		],
	})
	const natsLatestMessageSentTimestampSeconds = new Gauge({
		name: 'nats_latest_msg_sent_timestamp_seconds',
		help: 'when the latest message has been sent to NATS',
		registers: [register],
		labelNames: [
			'topic_root', // first "segment" of the topic, e.g. `AUS` with `aus.istfahrt.foo.bar`
		],
	})
	// NATS gives separate sequence numbers to both a) messages in a stream and b) messages as (re-)received by a consumer.
	// We currently use `msg.seq`, which is the stream sequence (not the consumer sequence) of the message.
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
		labelNames: [
			'cached',
		],
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

			if (isMatched || publishUnmatchedTripUpdates) {
				const topic = getNatsTopicFromGtfsRtTripUpdate(gtfsRtTripUpdate)
				const tPublished = Date.now()

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

				// update NATS metrics
				{
					// We slice() to keep the cardinality low in case of a bug.
					const topic_root = (topic.split('.')[0] || '').slice(0, 7)
					natsNrOfMessagesSentTotal.inc({
						topic_root,
					})
					natsLatestMessageSentTimestampSeconds.set({
						topic_root,
					}, tPublished / 1000)
				}
			}

			if (isMatched) {
				successesTotal.inc({
					cached: isCached ? '1' : '0',
				})
			} else {
				failuresTotal.inc({
					cached: isCached ? '1' : '0',
				})
			}
			matchingTimeSeconds.observe({
				matched: isMatched ? '1' : '0',
				cached: isCached ? '1' : '0',
			}, matchingTime / 1000)

			if (!isMatched) {
				// > Indicate to the JetStream server that processing of the message failed and that the message should not be sent to the consumer again.
				// https://nats-io.github.io/nats.js/jetstream/interfaces/JsMsg.html#term
				msg.term()
			}
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
		const tReceived = Date.now()
		const {
			subject,
			seq, // stream sequence, not consumer sequence
			redelivered,
			data,
		} = msg
		serviceLogger.debug({
			subject,
			seq,
			redelivered,
			dataSlice: data.slice(0, 100).toString('utf8'),
		}, 'processing AUS IstFahrt msg')

		// > Indicate to the JetStream server that processing of the message is on going, and that the ack wait timer for the message should be reset preventing a redelivery.
		// https://nats-io.github.io/nats.js/jetstream/interfaces/JsMsg.html#working
		msg.working()

		// update NATS metrics
		{
			const {
				stream,
				consumer,
			} = msg.info
			// We slice() to keep the cardinality low in case of a bug.
			const topic_root = (subject.split('.')[0] || '').slice(0, 7)
			const redelivered = msg.info.redelivered ? '1' : '0'
			natsNrOfMessagesReceivedTotal.inc({
				stream, // name of the JetStream stream
				consumer, // name of the JetStream consumer
				topic_root,
				redelivered,
			})
			natsLatestMessageReceivedTimestampSeconds.set({
				stream, // name of the JetStream stream
				consumer, // name of the JetStream consumer
				topic_root,
				redelivered,
			}, tReceived / 1000)
			natsMsgSeq.set(seq)
		}

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
		{
			// query details of the NATS JetStream stream for AUS IstFahrts
			const stream = await natsJetstreamClient.streams.get(NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME)
			const streamInfo = await stream.info()
			serviceLogger.debug({
				streamInfo,
			}, 'using NATS JetStream stream for AUS IstFahrts')
		}

		const istFahrtsConsumer = await natsJetstreamClient.consumers.get(
			NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME,
			natsConsumerName,
		)

		{
			// query details of the (externally created) NATS JetStream consumer
			const consumerInfo = await istFahrtsConsumer.info()
			serviceLogger.debug({
				consumerInfo,
			}, 'using NATS JetStream consumer')
		}

		const istFahrtsSub = await istFahrtsConsumer.consume()
		// We're not interested in the values, processAusIstFahrtMsg() publishes by itself.
		asyncConsume(
			mapConcurrently(
				istFahrtsSub[Symbol.asyncIterator](),
				matchConcurrency,
				processAusIstFahrtMsg,
			),
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
