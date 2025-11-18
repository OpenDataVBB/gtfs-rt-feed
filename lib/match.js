import {ok} from 'node:assert'
import {cpus as osCpus} from 'node:os'
import {
	Counter,
	Summary,
} from 'prom-client'
import last from 'lodash/last.js'
import {createLogger} from './logger.js'
import {register} from './metrics.js'
import {
	NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME,
	NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME,
	connectToNats,
	JSONCodec,
} from './nats.js'
import {
	computeVdvFahrtId,
	createMergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts,
} from './merge-vdv-sollfahrts-istfahrts.js'
import {
	createMatchWithGtfs,
} from './raw-match.js'
import {
	getNatsTopicFromGtfsRtTripUpdate,
} from './gtfs-rt-mqtt-topics.js'
import {
	isProgrammerError,
} from './util.js'

const KIND_SOLLFAHRT = 'sollfahrt'
const KIND_ISTFAHRT = 'istfahrt'

const natsJson = JSONCodec()

const vdvMergingLogger = createLogger('vdv-merging', {
	level: (process.env.LOG_LEVEL_VDV_MERGING || 'WARN').toLowerCase(),
})
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
		extractDataSourceFromFahrtBezeichner,
	} = {
		natsConsumerName: process.env.MATCHING_CONSUMER_NAME
			? process.env.MATCHING_CONSUMER_NAME
			: 'gtfs-rt-feed',
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
		// Normalizes a string identifying a source of realtime data, extracted from a {Ist,Soll}Fahrt.FahrtID.FahrtBezeichner, so that it can be used in metric labels, logs, etc.
		// Prevents too many metric label combinations, which would cause many Prometheus time series to be created. (https://prometheus.io/docs/practices/naming/#labels)
		extractDataSourceFromFahrtBezeichner: (fahrtBezeichner) => {
			// note: There might be FahrtBezeichner values like `75861#DLr-D#ODEG`.
			const _parts = (fahrtBezeichner ?? '').split('#')
			const src = _parts.length > 1 && last(_parts).trim() || null
			if (src === null || src === '!ADD!') {
				return 'unknown'
			}
			if (src.toLowerCase() === 'nahverkehrsgesellschaft jerichower land') {
				return 'NJL'
			}
			if (src.length > 4) {
				// We assume this case to be rather rare. In case a realtime data source is added or changed to such a long identifier, we'll detect that and adapt the mapping here.
				return '-too-long-'
			}
			return src
		},
		...opt,
	}
	ok(Number.isInteger(natsAckWait), 'opt.natsAckWait must be an integer')

	const successesTotal = new Counter({
		name: 'matching_successes_total',
		help: 'number of successfully matched movements/trips',
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
	const vdvFahrtsTotal = new Counter({
		name: 'vdv_fahrts_total',
		help: 'number of REF-AUS SollFahrts/AUS IstFahrts, by data source',
		registers: [register],
		labelNames: [
			'kind', // sollfahrt, istfahrt
			'src', // data source/provider, extracted and normalized from .FahrtID.FahrtBezeichner
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
		],
	})
	const vdvFahrtHaltsTotal = new Summary({
		name: 'vdv_fahrt_halts_total',
		help: 'number of SollHalts/IstHalts per REF-AUS SollFahrt/AUS IstFahrt',
		registers: [register],
		labelNames: [
			'kind', // sollfahrt, istfahrt
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
		storeRefAusSollFahrt: storeVdvRefAusSollFahrtForLaterMerging,
		storeAusIstFahrt: storeVdvAusIstFahrtForLaterMerging,
		mergeVdvFahrtWithEquivalentRefAusSollFahrtAndAusIstFahrts: mergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts,
	} = await createMergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts({
		logger: vdvMergingLogger,
	})

	const {
		matchVdvAusIstFahrtWithGtfs,
		stop: stopMatching,
	} = await createMatchWithGtfs({
		logger,
	})

	const publishGtfsRtTripUpdateToNats = (gtfsRtTripUpdate, logCtx) => {
		const topic = getNatsTopicFromGtfsRtTripUpdate(gtfsRtTripUpdate)
		const tPublished = Date.now()

		logger.trace({
			...logCtx,
			topic,
			gtfsRtTripUpdate,
		}, 'publishing GTFS-RT TripUpdate')
		natsClient.publish(topic, natsJson.encode(gtfsRtTripUpdate))

		updateNatsMetricsForPublishedMsg(topic, tPublished)
	}

	const processVdvNatsMsg = async (msg, kind, kindTitle, haltsField, storeVdvFahrt) => {
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
		}, `processing ${kindTitle} msg`)

		// > Indicate to the JetStream server that processing of the message is on going, and that the ack wait timer for the message should be reset preventing a redelivery.
		// https://nats-io.github.io/nats.js/jetstream/interfaces/JsMsg.html#working
		msg.working()

		updateNatsMetricsForIncomingMsg(msg, tReceived)

		const matchingMetricsLabels = {
			with_sollfahrt: '?',
			with_komplett_istfahrt: '?',
			with_partial_istfahrts: '?',
		}
		let vdvFahrt = null
		try {
			vdvFahrt = msg.json(data)
		} catch (err) {
			serviceLogger.warn({
				err,
				subject,
				seq,
			}, `failure decoding ${kindTitle} msg`)
			// We don't nak() here because we don't want it to be redelivered, the message is invalid anyways.
			return;
		}

		const fahrtId = computeVdvFahrtId(vdvFahrt)
		if (!fahrtId) {
			// todo: log, msg.nak()
			return;
		}

		try {
			// todo: validate against schema, error-log and abort if invalid
			if (!Array.isArray(fahrtId, vdvFahrt[haltsField])) {
				const err = new Error(`${kindTitle} doesn't have an array ${haltsField}[]`)
				err.vdvFahrt = vdvFahrt
				throw err
			}

			{
				const fahrtBezeichner = vdvFahrt.FahrtID?.FahrtBezeichner ?? null
				const src = extractDataSourceFromFahrtBezeichner(fahrtBezeichner)
				vdvFahrtsTotal.inc({
					kind,
					src,
				})
			}
			vdvFahrtHaltsTotal.observe({
				kind,
			}, vdvFahrt[haltsField].length)

			await storeVdvFahrt(fahrtId, vdvFahrt)
			const {
				hasRefAusSollFahrt,
				hasKomplettfahrtAusIstFahrt,
				hasPartialAusIstFahrts,
				mergedIstFahrt: mergedVdvFahrt,
			} = await mergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts(fahrtId, vdvFahrt)
			// todo: trace-log?
			matchingMetricsLabels.with_sollfahrt = hasRefAusSollFahrt ? '1' : '0'
			matchingMetricsLabels.with_komplett_istfahrt = hasKomplettfahrtAusIstFahrt ? '1' : '0'
			matchingMetricsLabels.with_partial_istfahrts = hasPartialAusIstFahrts ? '1' : '0'

			const {
				item: gtfsRtTripUpdate,
				isMatched,
				isCached,
				matchingTime,
			} = await matchVdvAusIstFahrtWithGtfs(mergedVdvFahrt)

			if (isMatched || publishUnmatchedTripUpdates) {
				publishGtfsRtTripUpdateToNats(gtfsRtTripUpdate, {
					isMatched,
					isCached,
					matchingTime,
					// todo: log just a slice?
					mergedVdvFahrt,
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
			}, `successfully processed ${kindTitle} msg`)
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
					[kind]: vdvFahrt,
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
			}, `failure processing ${kindTitle} msg`)
			// Explicitly signal to NATS JetStream that this message could not be processed.
			msg.nak()
			if (isProgrammerError(err)) {
				throw err
			}
		}
	}

	const processRefAusSollFahrtMsg = async (msg) => {
		await processVdvNatsMsg(
			msg,
			KIND_SOLLFAHRT,
			'REF-AUS SollFahrt',
			'SollHalts',
			storeVdvRefAusSollFahrtForLaterMerging,
		)
	}

	// subscribe to REF-AUS SollFahrt messages
	{
		{
			// query details of the NATS JetStream stream for AUS IstFahrts
			const stream = await natsJetstreamClient.streams.get(NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME)
			const streamInfo = await stream.info()
			serviceLogger.debug({
				streamInfo,
			}, 'using NATS JetStream stream for REF-AUS SollFahrts')
			// todo: assert some properties?
			// strictEqual(streamInfo.config.discard, 'old', `NATS JetStream's discard must be "old"`)
		}
		{
			// query details of the (externally created) NATS JetStream consumer
			const sollFahrtsConsumer = await natsJetstreamClient.consumers.get(
				NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME,
				natsConsumerName,
			)
			const consumerInfo = await sollFahrtsConsumer.info()
			serviceLogger.debug({
				stream: NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME,
				consumerInfo,
			}, 'using NATS JetStream consumer for REF-AUS SollFahrts')
			// todo: assert some properties?
			// strictEqual(consumerInfo.config.deliver_policy, 'new', `REF-AUS JetStream consumer's deliver_policy must be "new"`)
			// strictEqual(consumerInfo.config.ack_policy, 'explicit', `REF-AUS JetStream consumer's ack_policy must be "explicit"`)
		}

		consumeStreamMsgsIndefinitely(
			NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME,
			natsConsumerName,
			matchConcurrency,
			processRefAusSollFahrtMsg,
		).catch(abortWithError)

		// todo: support SollUmlauf – would require adapting vdv-453-nats-adapter
	}

	const processAusIstFahrtMsg = async (msg) => {
		await processVdvNatsMsg(
			msg,
			KIND_ISTFAHRT,
			'AUS IstFahrt',
			'IstHalts',
			storeVdvAusIstFahrtForLaterMerging,
		)
	}

	// subscribe to AUS IstFahrt messages
	{
		{
			// query details of the NATS JetStream stream for AUS IstFahrts
			const stream = await natsJetstreamClient.streams.get(NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME)
			const streamInfo = await stream.info()
			serviceLogger.debug({
				streamInfo,
			}, 'using NATS JetStream stream for AUS IstFahrts')
		}
		{
			// query details of the (externally created) NATS JetStream consumer
			const istFahrtsConsumer = await natsJetstreamClient.consumers.get(
				NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME,
				natsConsumerName,
			)
			const consumerInfo = await istFahrtsConsumer.info()
			serviceLogger.debug({
				stream: NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME,
				consumerInfo,
			}, 'using NATS JetStream consumer for AUS IstFahrts')
		}

		consumeStreamMsgsIndefinitely(
			NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME,
			natsConsumerName,
			matchConcurrency,
			processAusIstFahrtMsg,
		).catch(abortWithError)

		// todo: support IstUmlauf – would require adapting vdv-453-nats-adapter
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
