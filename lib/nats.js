import {randomBytes} from 'node:crypto'
import {connect, JSONCodec} from 'nats'
import {MAJOR_VERSION} from './major-version.js'

const PREFIX = `gtfs-rt-${MAJOR_VERSION}-`

const connectToNats = async (cfg, connectOpts = {}) => {
	const {
		logger,
	} = cfg

	const r = randomBytes(2).toString('hex')
	connectOpts = {
		// >0 servers, each in `host:port` format, sperated by a comma
		servers: process.env.NATS_SERVERS ? process.env.NATS_SERVERS.split(',') : null,
		user: process.env.NATS_USER || null,
		password: process.env.NATS_PASSWORD || null,
		name: process.env.NATS_CLIENT_NAME || `${PREFIX}-${r}`,
		// todo: `noAsyncTraces` (default: false) – When true the client will not add additional context to errors associated with request operations. Setting this option to true will greatly improve performance of request/reply and JetStream publishers.
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

	return {
		natsClient,
	}
}

const jsonCodec = JSONCodec()

export {
	PREFIX,
	connectToNats,
	jsonCodec,
}
