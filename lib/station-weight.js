import {createHash} from 'node:crypto'
import QuickLRU from 'quick-lru'
import {createLogger} from './logger.js'
import {
	connectToPostgres,
	escapeForLikeOp,
} from './db.js'
import {performance} from 'node:perf_hooks'

const STATION_WEIGHTS_QUERY = `\
SELECT
	station_id,
	weight
FROM station_weights
WHERE station_id LIKE $1
LIMIT 2`
const STATION_WEIGHTS_QUERY_NAME = `station_weights_${createHash('sha1').update(STATION_WEIGHTS_QUERY).digest('hex').slice(0, 3)}`

const createQueryStationWeight = async (opt = {}) => {
	const {
		pgOpts,
		logger,
	} = {
		pgOpts: {},
		logger: createLogger('station-weight', {
			level: (process.env.LOG_LEVEL_STATION_WEIGHT || 'WARN').toLowerCase(),
		}),
		...opt,
	}

	const pg = await connectToPostgres(pgOpts)

	const cache = new QuickLRU({
		maxSize: 5_000,
		maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
	})

	/**
	 * Looks up a station's estimated weight by its ID.
	 * Does *not* work with IFOPT[0]/DHID[1]-style IDs, expects just the region-specific part of the ID (e.g. `900083201` instead of `de:11000:900083201`)!
	 * [0] https://en.wikipedia.org/wiki/Identification_of_Fixed_Objects_in_Public_Transport
	 * [1] https://www.delfi.de/de/strategie-technik/architektur/
	 *
	 * @param {string} stationId The "local" station ID (a.k.a. region-specific part of the DHID/IFOPT).
	 * @returns {(number|null)} Returns the station's estimated weight. Null if the station does not occur in the GTFS Schedule dataset.
	 */
	const queryStationWeight = async (stationId) => {
		const logCtx = {
			stationId,
		}

		// todo: expose cache hit ratio as metric
		// todo: expose DB query & cache read/write times as metrics
		let matchedStations = null
		logCtx.isCached = false
		{
			const cacheId = stationId

			// read from cache
			const matchedStationsFromCache = cache.has(cacheId) ? cache.get(cacheId) : null

			if (matchedStationsFromCache !== null) {
				matchedStations = matchedStationsFromCache
				logCtx.isCached = true
				logger.debug({
					...logCtx,
				}, 'read station weights from cache')
			} else {
				// query DB
				const t0 = performance.now()
				const {
					rows,
				} = await pg.query({
					name: STATION_WEIGHTS_QUERY_NAME,
					text: STATION_WEIGHTS_QUERY,
					values: [
						// We assume IFOPT[0]/DHID[1]-style stop IDs here.
						// [0] https://en.wikipedia.org/wiki/Identification_of_Fixed_Objects_in_Public_Transport
						// [1] https://www.delfi.de/de/strategie-technik/architektur/
						`%:${escapeForLikeOp(stationId)}`,
					],
				})
				const dbQueryTime = performance.now() - t0
				logCtx.dbQueryTime = +dbQueryTime.toFixed(2)

				matchedStations = rows

				// write to cache
				cache.set(cacheId, matchedStations)
			}
		}

		if (matchedStations.length === 0) {
			logger.warn({
				...logCtx,
			}, 'no matching stations found')
			return null
		}
		if (matchedStations.length > 1) {
			logger.warn({
				...logCtx,
				matchedStations,
			}, '>1 matching station, ignoring ambiguous match')
			return null
		}
		logger.trace({
			...logCtx,
			matchedStations,
		}, 'found matching station weight')

		return matchedStations[0].weight
	}

	const stop = async () => {
		cache.clear()
		await pg.end()
	}

	return {
		queryStationWeight,
		stop,
	}
}

export {
	createQueryStationWeight,
}
