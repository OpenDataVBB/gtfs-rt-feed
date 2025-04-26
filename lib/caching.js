import {ok, strictEqual} from 'node:assert/strict'
// import createDebug from 'debug'
// import {performance} from 'node:perf_hooks'
import {connectToRedis} from './redis.js'

// const debug = createDebug('match-gtfs-rt-to-gtfs:caching')

const DATA_VERSION = 1
const PREFIX = DATA_VERSION + ':'

const createCache = async (opt = {}) => {
	const {
		noCaching,
		prefix: _prefix,
		ttl,
	} = {
		noCaching: false, // completely bypass the cache
		prefix: '',
		ttl: 5 * 60 * 60 * 1000, // 5h
		...opt,
	}

	const prefix = PREFIX + _prefix

	const redis = await connectToRedis()

	const get = async (key) => {
		if (noCaching) return null

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

	const getMany = async (_prefix, maxItems = 100) => {
		if (noCaching) return []

		ok(!_prefix.includes('*'), 'prefix must not include a literal *')
		// https://redis.io/docs/latest/commands/scan/
		// Note: We assume that there are no more than 200 IRIS TimetableStops to query!
		const [cursor, keys] = await redis.scan(
			'0', // initial value
			'MATCH', prefix + _prefix + '*',
			'COUNT', String(maxItems),
		)
		strictEqual(cursor, '0', `SCAN cursor must be 0, more than ${maxItems} items in the range`)

		if (keys.length === 0) {
			return []
		}
		const rows = await redis.mget(...keys)
		return rows
		.map((row, i) => [
			keys[i].slice(prefix.length),
			row !== null ? JSON.parse(row) : null,
		])
		.filter(([_, item]) => item !== null)
	}

	const put = async (key, item) => {
		if (noCaching) return;

		key = prefix + key

		// const t0 = performance.now()
		await redis.set(key, JSON.stringify(item), 'PX', ttl)
		// const timePassed = Math.round(performance.now() - t0)
	}

	const putMany = async (entries) => {
		ok(Array.isArray(entries), 'entries must be an array')
		ok(entries.length > 0, 'entries must not be empty')

		if (noCaching) return;

		// const t0 = performance.now()
		const batch = redis.pipeline()
		for (const [key, item] of entries) {
			batch.set(prefix + key, JSON.stringify(item), 'PX', ttl)
		}
		await batch.exec()
		// const timePassed = Math.round(performance.now() - t0)
	}

	const stop = async () => {
		await redis.quit()
	}

	return {
		get,
		getMany,
		put,
		putMany,
		stop,
	}
}

export {
	createCache,
}
