import Redis from 'ioredis'

const baseOpts = {}
if (process.env.REDIS_URL) {
	const url = new URL(process.env.REDIS_URL)
	baseOpts.host = url.hostname || 'localhost'
	baseOpts.port = url.port || '6379'
	if (url.password) baseOpts.password = url.password
	if (url.pathname && url.pathname.length > 1) {
		baseOpts.db = parseInt(url.pathname.slice(1))
	}
}
Object.freeze(baseOpts)

const connectToRedis = async (opt = {}) => {
	return new Redis({
		...baseOpts,
		opt,
	})
}

export {
	connectToRedis,
	baseOpts,
}
