import {ok} from 'node:assert'
import {
	Counter,
	Summary,
} from 'prom-client'
import last from 'lodash/last.js'
import Redlock from 'redlock'
import {createLogger} from './logger.js'
import {register} from './metrics.js'
import {
	NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME,
	NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME,
	connectToNats,
	JSONCodec,
} from './nats.js'
import {connectToRedis} from './redis.js'
import {
	computeVdvFahrtId,
	createMergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts,
} from './merge-vdv-sollfahrts-istfahrts.js'
import {
	isProgrammerError,
} from './util.js'

const KIND_SOLLFAHRT = 'sollfahrt'
const KIND_ISTFAHRT = 'istfahrt'

const natsJson = JSONCodec()

const vdvMergingLogger = createLogger('vdv-merging', {
	level: (process.env.LOG_LEVEL_VDV_MERGING || 'WARN').toLowerCase(),
})
const logger = createLogger('vdv-reconciliation', {
	level: (process.env.LOG_LEVEL_VDV_RECONCILIATION || 'warn').toLowerCase(),
})

const abortWithError = (err) => {
	logger.error(err)
	process.exit(1)
}

const runVdvReconciliation = async (cfg, opt = {}) => {
	const {
		logger: serviceLogger,
	} = cfg
	ok(serviceLogger)

	const {
		natsConsumerName,
		natsAckWait, // in milliseconds
		reconciliationConcurrency,
		extractDataSourceFromFahrtBezeichner,
	} = {
		natsConsumerName: process.env.RECONCILIATION_CONSUMER_NAME
			? process.env.RECONCILIATION_CONSUMER_NAME
			: 'gtfs-rt-feed:vdv-reconciliation',
		natsAckWait: 60 * 1000, // 60 seconds
		reconciliationConcurrency: process.env.RECONCILIATION_CONCURRENCY
			? parseInt(process.env.RECONCILIATION_CONCURRENCY)
			: 30,
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

	const lockingTimeSeconds = new Summary({
		name: 'reconciliation_locking_time_seconds',
		help: `seconds the mutually exclusive locking of each VDV Fahrt's ID took`,
		registers: [register],
	})
	const successfulReconciliationTotal = new Counter({
		name: 'reconciliation_successes_total',
		help: 'number of successful VDV Fahrt reconciliation operations',
		registers: [register],
		labelNames: [
			'with_sollfahrt', // merged Fahrt contains a REF-AUS SollFahrt
			'with_komplett_istfahrt', // merged Fahrt contains a Komplettfahrt=true AUS IstFahrt
			'with_partial_istfahrts', // merged Fahrt contains >0 partial AUS IstFahrts
		],
	})
	const erroredReconciliationTotal = new Counter({
		name: 'reconciliation_errors_total',
		help: 'number of errors that have occured while merging',
		registers: [register],
		labelNames: [
			'with_sollfahrt', // merged Fahrt contains a REF-AUS SollFahrt
			'with_komplett_istfahrt', // merged Fahrt contains a Komplettfahrt=true AUS IstFahrt
			'with_partial_istfahrts', // merged Fahrt contains >0 partial AUS IstFahrts
		],
	})
	const reconciliationTimeSeconds = new Summary({
		name: 'reconciliation_time_seconds',
		help: 'seconds each VDV Fahrt needs to be merged with stored equivalent data',
		registers: [register],
		labelNames: [
			'with_sollfahrt', // merged IstFahrt contains a REF-AUS SollFahrt
			'with_komplett_istfahrt', // merged IstFahrt contains a Komplettfahrt=true AUS IstFahrt
			'with_partial_istfahrts', // merged IstFahrt contains >0 partial AUS IstFahrts
			'errored',
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
	const vdvFahrtHaltsTotal = new Summary({
		name: 'vdv_fahrt_halts_total',
		help: 'number of SollHalts/IstHalts per REF-AUS SollFahrt/AUS IstFahrt',
		registers: [register],
		labelNames: [
			'kind', // sollfahrt, istfahrt
			'src', // data source/provider, extracted and normalized from .FahrtID.FahrtBezeichner
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

	const redis = await connectToRedis()

	// implements the RedLock algorithm (http://redis.io/topics/distlock)
	const semaphore = new Redlock([
		redis,
	], {
		retryDelay: 30, // ms – default is 200
		retryJitter: 30, // ms – default is 200
		automaticExtensionThreshold: 50, // ms – default is 500
	})

	const {
		storeRefAusSollFahrt: storeVdvRefAusSollFahrtForLaterMerging,
		storeAusIstFahrt: storeVdvAusIstFahrtForLaterMerging,
		mergeVdvFahrtWithEquivalentRefAusSollFahrtAndAusIstFahrts: mergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts,
	} = await createMergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts({
		logger: vdvMergingLogger,
		redis,
	})

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

		const metricsLabels = {
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

		// lock `fahrtId` for at least 100ms to prevent concurrent processing of equal VDV Fahrts
		const tBeforeLock = performance.now()
		const lock = await semaphore.acquire([fahrtId], 100)
		const lockingTime = Math.round((performance.now() - tBeforeLock) * 100) / 100 // round to 2 digits
		lockingTimeSeconds.observe(lockingTime / 1000)

		try {
			// todo: validate against schema, error-log and abort if invalid
			if (!Array.isArray(vdvFahrt[haltsField])) {
				const err = new Error(`${kindTitle} doesn't have an array ${haltsField}[]`)
				err.vdvFahrt = vdvFahrt
				throw err
			}

			const fahrtBezeichner = vdvFahrt.FahrtID?.FahrtBezeichner ?? null
			const src = extractDataSourceFromFahrtBezeichner(fahrtBezeichner)
			vdvFahrtsTotal.inc({
				kind,
				src,
			})
			vdvFahrtHaltsTotal.observe({
				kind,
				src,
			}, vdvFahrt[haltsField].length)

			const t0 = performance.now()
			await storeVdvFahrt(fahrtId, vdvFahrt)
			const {
				hasRefAusSollFahrt,
				hasKomplettfahrtAusIstFahrt,
				hasPartialAusIstFahrts,
				mergedIstFahrt: mergedVdvFahrt,
			} = await mergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts(fahrtId, vdvFahrt)
			const reconciliationTime = Math.round((performance.now() - t0) * 100) / 100 // round to 2 digits

			// todo: trace-log?
			metricsLabels.with_sollfahrt = hasRefAusSollFahrt ? '1' : '0'
			metricsLabels.with_komplett_istfahrt = hasKomplettfahrtAusIstFahrt ? '1' : '0'
			metricsLabels.with_partial_istfahrts = hasPartialAusIstFahrts ? '1' : '0'
			successfulReconciliationTotal.inc({
				...metricsLabels,
			})
			reconciliationTimeSeconds.observe({
				...metricsLabels,
				errored: '0',
			}, reconciliationTime / 1000)

			{
				const topic = 'vdv.fahrt.foo' // todo: sth useful
				const tPublished = Date.now()

				logger.trace({
					topic,
					fahrtId,
					mergedVdvFahrt,
				}, 'publishing merged VDV Fahrt')
				// todo: set message TTL?
				// see https://github.com/nats-io/nats-architecture-and-design/blob/e9ed4e822865553500a7eca46af9e5c315bd813d/adr/ADR-43.md
				natsClient.publish(topic, natsJson.encode(mergedVdvFahrt))

				updateNatsMetricsForPublishedMsg(topic, tPublished)
			}

			serviceLogger.trace({
				subject,
				seq,
				fahrtId,
				reconciliationTime,
			}, `successfully processed ${kindTitle} msg`)
			msg.ack()
		} catch (err) {
			if (!isProgrammerError(err)) {
				logger.warn({
					err,
					fahrtId,
					[kind]: vdvFahrt,
					natsMsgSeq: msg.seq,
				}, `failed to reconcile VDV Fahrt: ${err.message || (err + '')}`)
				erroredReconciliationTotal.inc({
					...metricsLabels,
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
		} finally {
			await lock.release()
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
		}

		consumeStreamMsgsIndefinitely(
			NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME,
			natsConsumerName,
			reconciliationConcurrency,
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
			reconciliationConcurrency,
			processAusIstFahrtMsg,
		).catch(abortWithError)

		// todo: support IstUmlauf – would require adapting vdv-453-nats-adapter
	}

	const stop = async () => {
		await redis.quit()
		natsClient.drain()
	}

	return {
		stop,
	}
}

export {
	runVdvReconciliation,
}
