import {ok} from 'node:assert'
import {cpus as osCpus} from 'node:os'
import {
	Counter,
	Summary,
} from 'prom-client'
import {createLogger} from './logger.js'
import {register} from './metrics.js'
import {
	NATS_JETSTREAM_VDV_FAHRT_STREAM_NAME,
	connectToNats,
	JSONCodec,
} from './nats.js'
import {
	createMatchWithGtfs,
} from './raw-match.js'
import {
	getNatsSubjectFromGtfsRtTripUpdate,
} from './gtfs-rt-mqtt-topics.js'
import {
	isProgrammerError,
} from './util.js'

const natsJson = JSONCodec()

const logger = createLogger('matching', {
	level: (process.env.LOG_LEVEL_MATCHING || 'warn').toLowerCase(),
})

const abortWithError = (err) => {
	logger.error(err)
	process.exit(1)
}

const runGtfsMatching = async (cfg, opt = {}) => {
	const {
		logger: serviceLogger,
	} = cfg
	ok(serviceLogger)

	const {
		natsConsumerName,
		natsAckWait, // in milliseconds
		matchConcurrency,
		publishUnmatchedTripUpdates,
	} = {
		natsConsumerName: process.env.MATCHING_CONSUMER_NAME
			? process.env.MATCHING_CONSUMER_NAME
			: 'gtfs-rt-feed:gtfs-matching',
		natsAckWait: 60 * 1000, // 60 seconds
		matchConcurrency: process.env.MATCHING_CONCURRENCY
			? parseInt(process.env.MATCHING_CONCURRENCY)
			// this makes assumptions about how PostgreSQL scales
			// todo: query the *PostgreSQL server's* nr of cores, instead of the machine's that hafas-gtfs-rt-feed runs on
			// todo: raw-match.js uses pg.Pool, which has a max connection limit, so this option here is a bit useless...
			// but it seems there's no clean way to determine this
			//     CREATE TEMPORARY TABLE cpu_cores (num_cores integer);
			//     COPY cpu_cores (num_cores) FROM PROGRAM 'sysctl -n hw.ncpu';
			//     SELECT num_cores FROM cpu_cores LIMIT 1
			// same as with hafas-gtfs-rt-feed: https://github.com/derhuerst/hafas-gtfs-rt-feed/blob/8.2.6/lib/match.js#L54-L61
			: Math.ceil(1 + osCpus().length * 1.2),
		publishUnmatchedTripUpdates: process.env.MATCHING_PUBLISH_UNMATCHED_TRIPUPDATES
			? process.env.MATCHING_PUBLISH_UNMATCHED_TRIPUPDATES === 'true'
			: false,
		...opt,
	}
	ok(Number.isInteger(natsAckWait), 'opt.natsAckWait must be an integer')

	const successesTotal = new Counter({
		name: 'matching_successes_total',
		help: 'number of successfully matched VDV Fahrts',
		registers: [register],
		labelNames: [
			'with_sollfahrt', // merged IstFahrt contains a REF-AUS SollFahrt
			'with_komplett_istfahrt', // merged IstFahrt contains a Komplettfahrt=true AUS IstFahrt
			'with_partial_istfahrts', // merged IstFahrt contains >0 partial AUS IstFahrts
			'cached',
		],
	})
	const failuresTotal = new Counter({
		name: 'matching_failures_total',
		help: 'number of matching failures',
		registers: [register],
		labelNames: [
			'with_sollfahrt', // merged IstFahrt contains a REF-AUS SollFahrt
			'with_komplett_istfahrt', // merged IstFahrt contains a Komplettfahrt=true AUS IstFahrt
			'with_partial_istfahrts', // merged IstFahrt contains >0 partial AUS IstFahrts
			'cached',
		],
	})
	const errorsTotal = new Counter({
		name: 'matching_errors_total',
		help: 'number of errors that have occured while matching',
		registers: [register],
		labelNames: [
			'with_sollfahrt', // merged IstFahrt contains a REF-AUS SollFahrt
			'with_komplett_istfahrt', // merged IstFahrt contains a Komplettfahrt=true AUS IstFahrt
			'with_partial_istfahrts', // merged IstFahrt contains >0 partial AUS IstFahrts
		],
	})
	const matchingTimeSeconds = new Summary({
		name: 'matching_time_seconds',
		help: 'seconds trips need to be matched',
		registers: [register],
		labelNames: [
			'with_sollfahrt', // merged IstFahrt contains a REF-AUS SollFahrt
			'with_komplett_istfahrt', // merged IstFahrt contains a Komplettfahrt=true AUS IstFahrt
			'with_partial_istfahrts', // merged IstFahrt contains >0 partial AUS IstFahrts
			'matched',
			'cached',
			// todo: schedule_feed_digest (slice)
		],
	})

	const {
		natsClient,
		natsJetstreamClient,
		updateNatsMetricsForIncomingMsg,
		updateNatsMetricsForPublishedMsg,
		consumeStreamMsgsIndefinitely,
	} = await connectToNats({
		extraMetricLabels: [],
	})

	const {
		matchVdvAusIstFahrtWithGtfs,
		stop: stopMatching,
	} = await createMatchWithGtfs({
		logger,
	})

	const publishGtfsRtTripUpdateToNats = (gtfsRtTripUpdate, logCtx) => {
		const subject = getNatsSubjectFromGtfsRtTripUpdate(gtfsRtTripUpdate)
		const tPublished = Date.now()

		logger.trace({
			...logCtx,
			subject,
			gtfsRtTripUpdate,
		}, 'publishing GTFS-RT TripUpdate')
		natsClient.publish(subject, natsJson.encode(gtfsRtTripUpdate))

		updateNatsMetricsForPublishedMsg(subject, tPublished)
	}

	const processVdvFahrtNatsMsg = async (msg) => {
		const tReceived = Date.now()
		const {
			subject,
			seq, // stream sequence, not consumer sequence
			redelivered,
			data,
			info: {
				streamSequence: streamSeq,
			},
		} = msg
		serviceLogger.debug({
			subject,
			seq,
			streamSeq,
			redelivered,
			dataSlice: data.slice(0, 100).toString('utf8'),
		}, 'processing VDV Fahrt msg')

		// > Indicate to the JetStream server that processing of the message is on going, and that the ack wait timer for the message should be reset preventing a redelivery.
		// https://nats-io.github.io/nats.js/jetstream/interfaces/JsMsg.html#working
		msg.working()

		updateNatsMetricsForIncomingMsg(msg, tReceived)

		const matchingMetricsLabels = {
			with_sollfahrt: hasRefAusSollFahrt ? '1' : '0',
			with_komplett_istfahrt: hasKomplettfahrtAusIstFahrt ? '1' : '0',
			with_partial_istfahrts: hasPartialAusIstFahrts ? '1' : '0',
		}
		let vdvFahrt = null
		try {
			vdvFahrt = msg.json(data)
		} catch (err) {
			serviceLogger.warn({
				err,
				subject,
				seq,
			}, 'failure decoding VDV Fahrt msg')
			// We don't nak() here because we don't want it to be redelivered, the message is invalid anyways.
			return;
		}

		try {
			// todo: validate against schema, error-log and abort if invalid
			if (!Array.isArray(vdvFahrt[haltsField])) {
				const err = new Error(`VDV Fahrt doesn't have an array ${haltsField}[]`)
				err.vdvFahrt = vdvFahrt
				throw err
			}

			const {
				item: gtfsRtTripUpdate,
				isMatched,
				isCached,
				matchingTime,
			} = await matchVdvAusIstFahrtWithGtfs(vdvFahrt)

			if (isMatched || publishUnmatchedTripUpdates) {
				publishGtfsRtTripUpdateToNats(gtfsRtTripUpdate, {
					isMatched,
					isCached,
					matchingTime,
					// todo: log just a slice?
					vdvFahrt,
					natsMsgSeq: msg.seq,
				})
			}

			if (isMatched) {
				successesTotal.inc({
					...matchingMetricsLabels,
					cached: isCached ? '1' : '0',
				})
			} else {
				failuresTotal.inc({
					...matchingMetricsLabels,
					cached: isCached ? '1' : '0',
				})
			}
			matchingTimeSeconds.observe({
				...matchingMetricsLabels,
				matched: isMatched ? '1' : '0',
				cached: isCached ? '1' : '0',
			}, matchingTime / 1000)

			serviceLogger.trace({
				subject,
				seq,
			}, 'successfully processed VDV Fahrt msg')
			if (isMatched) {
				msg.ack()
			} else {
				// > Indicate to the JetStream server that processing of the message failed and that the message should not be sent to the consumer again.
				// https://nats-io.github.io/nats.js/jetstream/interfaces/JsMsg.html#term
				msg.term()
			}
		} catch (err) {
			if (!isProgrammerError(err)) {
				logger.warn({
					err,
					vdvFahrt,
					natsMsgSeq: msg.seq,
				}, `failed to match trip: ${err.message || (err + '')}`)
				errorsTotal.inc({
					...matchingMetricsLabels,
				})
			}

			// We catch all non-programmer errors in order not to abort the message processing (see below).
			serviceLogger.warn({
				err,
				subject,
				seq,
			}, 'failure processing VDV Fahrt msg')
			// Explicitly signal to NATS JetStream that this message could not be processed.
			msg.nak()
			if (isProgrammerError(err)) {
				throw err
			}
		}
	}

	// subscribe to AUS IstFahrt messages
	{
		{
			// query details of the NATS JetStream stream for AUS IstFahrts
			const stream = await natsJetstreamClient.streams.get(NATS_JETSTREAM_VDV_FAHRT_STREAM_NAME)
			const streamInfo = await stream.info()
			serviceLogger.debug({
				streamInfo,
			}, 'using NATS JetStream stream for AUS IstFahrts')
		}
		{
			// query details of the (externally created) NATS JetStream consumer
			const istFahrtsConsumer = await natsJetstreamClient.consumers.get(
				NATS_JETSTREAM_VDV_FAHRT_STREAM_NAME,
				natsConsumerName,
			)
			const consumerInfo = await istFahrtsConsumer.info()
			serviceLogger.debug({
				stream: NATS_JETSTREAM_VDV_FAHRT_STREAM_NAME,
				consumerInfo,
			}, 'using NATS JetStream consumer for AUS IstFahrts')
		}

		consumeStreamMsgsIndefinitely(
			NATS_JETSTREAM_VDV_FAHRT_STREAM_NAME,
			natsConsumerName,
			matchConcurrency,
			processVdvFahrtNatsMsg,
		).catch(abortWithError)

		// todo: support SollUmlauf/IstUmlauf – would require adapting vdv-453-nats-adapter & vdv-reconciliation
	}

	const stop = async () => {
		await stopMatching()
		natsClient.drain()
	}

	return {
		stop,
	}
}

export {
	runGtfsMatching,
}
