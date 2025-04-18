// import createDebug from 'debug'
// import {performance} from 'node:perf_hooks'
import {connectToRedis} from './redis.js'

// const debug = createDebug('match-gtfs-rt-to-gtfs:caching')

const NO_CACHING = process.env.MATCH_GTFS_RT_TO_GTFS_CACHING === 'false'

const DATA_VERSION = 1
const PREFIX = DATA_VERSION + ':'

const createCache = async (opt = {}) => {
	const {
		prefix: _prefix,
		ttl,
	} = {
		prefix: '',
		ttl: 5 * 60 * 60 * 1000, // 5h
		...opt,
	}

	const prefix = PREFIX + _prefix

	const redis = await connectToRedis()

	const get = async (key) => {
		if (NO_CACHING) return null

		key = prefix + key

		// todo: expose metrics?
		// const t0 = performance.now()
		let item = await redis.getex(key, 'PX', ttl)
		if (item !== null) {
			item = JSON.parse(item)
		}
		// const timePassed = Math.round(performance.now() - t0)

		return item
	}

	const put = async (key, item) => {
		if (NO_CACHING) return;

		key = prefix + key

		// const t0 = performance.now()
		await redis.set(key, JSON.stringify(item), 'PX', ttl)
		// const timePassed = Math.round(performance.now() - t0)
	}

	const stop = async () => {
		await redis.quit()
	}

	return {
		get,
		put,
		stop,
	}
}

export {
	createCache,
}
