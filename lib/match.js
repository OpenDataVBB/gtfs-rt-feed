import {ok} from 'node:assert'
import {cpus as osCpus} from 'node:os'
import {
	Gauge,
	Counter,
	Summary,
} from 'prom-client'
import last from 'lodash/last.js'
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
	createMergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts,
} from './merge-vdv-sollfahrts-istfahrts.js'
import {
	createMatchWithGtfs,
} from './raw-match.js'
import {withSoftExit} from './soft-exit.js'
import {MAJOR_VERSION} from './major-version.js'
import {
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

const KIND_SOLLFAHRT = 'sollfahrt'
const KIND_ISTFAHRT = 'istfahrt'

// todo: DRY with OpenDataVBB/nats-consuming-gtfs-rt-server
const NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME = `REF_AUS_SOLLFAHRT_${MAJOR_VERSION}`
const NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME = `AUS_ISTFAHRT_${MAJOR_VERSION}`

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

	// NATS-related metrics
	// Note: We mirror OpenDataVBB/gtfs-rt-feed's metrics here.
	const natsNrOfMessagesReceivedTotal = new Counter({
		name: 'nats_nr_of_msgs_received_total',
		help: 'number of messages received from NATS',
		registers: [register],
		labelNames: [
			'stream', // name of the JetStream stream
			'consumer', // name of the JetStream consumer
			'topic_root', // first "segment" of the topic, e.g. `aus` with `aus.istfahrt.foo.bar`
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
			'topic_root', // first "segment" of the topic, e.g. `aus` with `aus.istfahrt.foo.bar`
			'redelivered', // 1/0
		],
	})
	// todo: track redeliveries as `Summary` using `msg.info.redeliveryCount`
	const natsNrOfMessagesSentTotal = new Counter({
		name: 'nats_nr_of_msgs_sent_total',
		help: 'number of messages sent to NATS',
		registers: [register],
		labelNames: [
			'topic_root', // first "segment" of the topic, e.g. `aus` with `aus.istfahrt.foo.bar`
		],
	})
	const natsLatestMessageSentTimestampSeconds = new Gauge({
		name: 'nats_latest_msg_sent_timestamp_seconds',
		help: 'when the latest message has been sent to NATS',
		registers: [register],
		labelNames: [
			'topic_root', // first "segment" of the topic, e.g. `aus` with `aus.istfahrt.foo.bar`
		],
	})
	// NATS gives separate sequence numbers to both a) messages in a stream and b) messages as (re-)received by a consumer.
	// We currently use `msg.seq`, which is the stream sequence (not the consumer sequence) of the message.
	const natsMsgSeq = new Gauge({
		// todo [breaking]: rename to e.g. nats_latest_msg_received_seq for consistency
		name: 'nats_msg_seq',
		help: 'sequence number of the latest NATS message being processed',
		registers: [register],
		labelNames: [
			'topic_root', // first "segment" of the topic, e.g. `aus` with `aus.istfahrt.foo.bar`
		],
	})

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
		],
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
			natsMsgSeq.set({topic_root}, seq)
		}

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

		try {
			// todo: validate against schema, error-log and abort if invalid
			if (!Array.isArray(vdvFahrt[haltsField])) {
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

			await storeVdvFahrt(vdvFahrt)
			const {
				hasRefAusSollFahrt,
				hasKomplettfahrtAusIstFahrt,
				hasPartialAusIstFahrts,
				mergedIstFahrt: mergedVdvFahrt,
			} = await mergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts(vdvFahrt)
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

		const sollFahrtsConsumer = await natsJetstreamClient.consumers.get(
			NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME,
			natsConsumerName,
		)

		{
			// query details of the (externally created) NATS JetStream consumer
			const consumerInfo = await sollFahrtsConsumer.info()
			serviceLogger.debug({
				stream: NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME,
				consumerInfo,
			}, 'using NATS JetStream consumer for REF-AUS SollFahrts')
			// todo: assert some properties?
			// strictEqual(consumerInfo.config.deliver_policy, 'new', `REF-AUS JetStream consumer's deliver_policy must be "new"`)
			// strictEqual(consumerInfo.config.ack_policy, 'explicit', `REF-AUS JetStream consumer's ack_policy must be "explicit"`)
		}

		const sollFahrtsSub = await sollFahrtsConsumer.consume()
		// We're not interested in the values, processRefAusSollFahrtMsg() publishes by itself.
		asyncConsume(
			mapConcurrently(
				sollFahrtsSub[Symbol.asyncIterator](),
				matchConcurrency,
				processRefAusSollFahrtMsg,
			),
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

		const istFahrtsConsumer = await natsJetstreamClient.consumers.get(
			NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME,
			natsConsumerName,
		)

		{
			// query details of the (externally created) NATS JetStream consumer
			const consumerInfo = await istFahrtsConsumer.info()
			serviceLogger.debug({
				stream: NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME,
				consumerInfo,
			}, 'using NATS JetStream consumer for AUS IstFahrts')
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
