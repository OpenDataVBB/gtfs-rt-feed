import {randomBytes} from 'node:crypto'
import {
	AckPolicy,
	connect,
	JSONCodec,
} from 'nats'
import {
	Gauge,
	Counter,
} from 'prom-client'
import {
	asyncConsume,
} from 'iter-tools'
import {
	mapConcurrent as mapConcurrently,
} from 'async-iterator-concurrent-map'
import {MAJOR_VERSION} from './major-version.js'
import {register} from './metrics.js'
import {createLogger} from './logger.js'

const PREFIX = `gtfs-rt-feed-${MAJOR_VERSION}-`

// todo: DRY with OpenDataVBB/gtfs-rt-infrastructure
const NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME = `REF_AUS_SOLLFAHRT_${MAJOR_VERSION}`
const NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME = `AUS_ISTFAHRT_${MAJOR_VERSION}`
const NATS_JETSTREAM_VDV_FAHRT_STREAM_NAME = `VDV_FAHRT_${MAJOR_VERSION}`

// todo: DRY with OpenDataVBB/nats-consuming-gtfs-rt-server
const connectToNats = async (cfg, connectOpts = {}) => {
	const {
		extraMetricLabels,
	} = cfg

	const logger = createLogger('nats')

	const r = randomBytes(2).toString('hex')
	connectOpts = {
		// >0 servers, each in `host:port` format, sperated by a comma
		servers: process.env.NATS_SERVERS ? process.env.NATS_SERVERS.split(',') : null,
		user: process.env.NATS_USER || null,
		password: process.env.NATS_PASSWORD || null,
		name: process.env.NATS_CLIENT_NAME || `${PREFIX}-${r}`,
		// todo: `noAsyncTraces` (default: false) – When true the client will not add additional context to errors associated with request operations. Setting this option to true will greatly improve performance of request/reply and JetStream publishers.

		// > By default, for the sake of efficiency, subject names are not verified during message publishing. In particular, when generating subjects programmatically, this will result in illegal subjects which cannot be subscribed to. E.g. subjects containing wildcards may be ignored.
		// > To enable subject name verification, activate pedantic mode in the client connection options.
		// https://docs.nats.io/nats-concepts/subjects#pedantic-mode
		pedantic: true,

		...connectOpts,
	}

	const natsClient = await connect(connectOpts)
	logger.debug({
		connectOpts,
	}, 'connected to NATS')
	natsClient.closed()
	.then((err) => {
		if (!err) return;
		logger.warn({
			err,
			connectOpts,
		}, 'NATS client closed with error')
	})

	const natsJetstreamClient = await natsClient.jetstream()

	// todo: rename
	const natsNrOfMessagesReceivedTotal = new Counter({
		name: 'nats_nr_of_msgs_received_total',
		help: 'number of messages received from NATS',
		registers: [register],
		labelNames: [
			'stream', // name of the JetStream stream
			'consumer', // name of the JetStream consumer
			'subject_root', // first "segment" of the NATS subject, e.g. `aus` with `aus.istfahrt.foo.bar`
			'redelivered', // 1/0
			...extraMetricLabels,
		],
	})
	const natsLatestMessageReceivedTimestampSeconds = new Gauge({
		name: 'nats_latest_msg_received_timestamp_seconds',
		help: 'when the latest message has been received from NATS',
		registers: [register],
		labelNames: [
			'stream', // name of the JetStream stream
			'consumer', // name of the JetStream consumer
			'subject_root', // first "segment" of the NATS subject, e.g. `aus` with `aus.istfahrt.foo.bar`
			'redelivered', // 1/0
			...extraMetricLabels,
		],
	})
	// todo: track redeliveries as `Summary` using `msg.info.redeliveryCount`
	const natsNrOfMessagesSentTotal = new Counter({
		name: 'nats_nr_of_msgs_sent_total',
		help: 'number of messages sent to NATS',
		registers: [register],
		labelNames: [
			'subject_root', // first "segment" of the NATS subject, e.g. `aus` with `aus.istfahrt.foo.bar`
			...extraMetricLabels,
		],
	})
	const natsLatestMessageSentTimestampSeconds = new Gauge({
		name: 'nats_latest_msg_sent_timestamp_seconds',
		help: 'when the latest message has been sent to NATS',
		registers: [register],
		labelNames: [
			'subject_root', // first "segment" of the NATS subject, e.g. `aus` with `aus.istfahrt.foo.bar`
			...extraMetricLabels,
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
			'subject_root', // first "segment" of the NATS subject, e.g. `aus` with `aus.istfahrt.foo.bar`
			...extraMetricLabels,
		],
	})

	const updateNatsMetricsForIncomingMsg = (msg, tReceived) => {
		const {
			subject,
			seq,
		} = msg
		const {
			stream,
			consumer,
		} = msg.info

		// We slice() to keep the cardinality low in case of a bug.
		const subject_root = (subject.split('.')[0] || '').slice(0, 7)
		const redelivered = msg.info.redelivered ? '1' : '0'
		natsNrOfMessagesReceivedTotal.inc({
			stream, // name of the JetStream stream
			consumer, // name of the JetStream consumer
			subject_root,
			redelivered,
		})
		natsLatestMessageReceivedTimestampSeconds.set({
			stream, // name of the JetStream stream
			consumer, // name of the JetStream consumer
			subject_root,
			redelivered,
		}, tReceived / 1000)
		natsMsgSeq.set({subject_root}, seq)
	}

	const updateNatsMetricsForPublishedMsg = (subject, tPublished) => {
		// We slice() to keep the cardinality low in case of a bug.
		const subject_root = (subject.split('.')[0] || '').slice(0, 7)
		natsNrOfMessagesSentTotal.inc({
			subject_root,
		})
		natsLatestMessageSentTimestampSeconds.set({
			subject_root,
		}, tPublished / 1000)
	}

	const consumeStreamMsgsIndefinitely = async (streamName, consumerName, concurrency, processMsg) => {
		const consumer = await natsJetstreamClient.consumers.get(
			streamName,
			consumerName,
		)

		const msgsIterable = await consumer.consume()
		// We're not interested in the values, processMsg() may publish new NATS msgs by itself.
		await asyncConsume(
			mapConcurrently(
				msgsIterable[Symbol.asyncIterator](),
				concurrency,
				processMsg,
			),
		)
	}

	return {
		natsClient,
		natsJetstreamClient,
		logger,
		updateNatsMetricsForIncomingMsg,
		updateNatsMetricsForPublishedMsg,
		consumeStreamMsgsIndefinitely,
	}
}

export {
	NATS_JETSTREAM_AUS_ISTFAHRT_STREAM_NAME,
	NATS_JETSTREAM_REF_AUS_SOLLFAHRT_STREAM_NAME,
	NATS_JETSTREAM_VDV_FAHRT_STREAM_NAME,
	PREFIX,
	connectToNats,
	AckPolicy,
	JSONCodec,
}
