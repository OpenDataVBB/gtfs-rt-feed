import {
	connectToPostgres,
	escapeForLikeOp,
} from './db.js'
import {createCache} from './caching.js'
import {performance} from 'node:perf_hooks'

const createQueryStationWeight = async (cfg, opt = {}) => {
	const {
		logger,
	} = cfg
	const {
		pgOpts,
	} = {
		pgOpts: {},
		...opt,
	}

	const pg = await connectToPostgres(pgOpts)

	const cache = await createCache({
		ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
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
			// todo: add Schedule feed version!
			const cacheId = stationId

			// read from cache
			const t0 = performance.now()
			const matchedStationsFromCache = await cache.get(cacheId)
			const cacheReadTime = performance.now() - t0
			logCtx.cacheReadTime = +cacheReadTime.toFixed(2)

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
					text: `\
						SELECT
							station_id,
							weight
						FROM station_weights
						WHERE station_id LIKE $1
						LIMIT 2
`,
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
				const t1 = performance.now()
				await cache.put(cacheId, matchedStations)
				const cacheWriteTime = performance.now() - t1
				logCtx.cacheWriteTime = +cacheWriteTime.toFixed(2)
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
		await pg.end()
		await cache.stop()
	}

	return {
		queryStationWeight,
		stop,
	}
}

export {
	createQueryStationWeight,
}
