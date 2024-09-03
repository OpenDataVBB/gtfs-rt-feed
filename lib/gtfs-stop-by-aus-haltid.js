import {strictEqual} from 'node:assert/strict'
import QuickLRU from 'quick-lru'
import {connectToPostgres} from './db.js'

const stripDataProviderPrefixFromAusHaltID = (ausHaltId) => {
	// remove data provider prefix, e.g.
	// - `ODEG_900210771`
	return /^[A-Z]+_/.test(ausHaltId)
		? ausHaltId.slice(ausHaltId.indexOf('_') + 1)
		: ausHaltId
}

// > If pattern does not contain percent signs or underscore, then the pattern only represents the string itself; in that case LIKE acts like the equals operator. An underscore (_) in pattern stands for (matches) any single character; a percent sign (%) matches any string of zero or more characters.
// > To match a literal underscore or percent sign without matching other characters, the respective character in pattern must be preceded by the escape character. […]
// > https://www.postgresql.org/docs/7.3/functions-matching.html
const escapeForLikeOp = (input) => {
	return input
	.replaceAll('\\', '\\\\')
	.replaceAll('%', '\\%')
	.replaceAll('_', '\\_')
}
strictEqual(
	escapeForLikeOp('foo\\bar\\\\baz%hey_there'),
	'foo\\\\bar\\\\\\\\baz\\%hey\\_there',
)

const createQueryGtfsStopByAusHaltID = async (cfg, opt = {}) => {
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

	const queryGtfsStopByAusHaltID = async (ausHaltId) => {
		const strippedHaltId = stripDataProviderPrefixFromAusHaltID(ausHaltId)

		const {
			rows: stops,
		} = await pg.query({
			// allow `pg` to create a prepared statement
			name: 'gtfs_stop_by_aus_haltid_v1',
			text: `\
SELECT
	stop_id,
	stop_name,
	st_x(stop_loc::geometry) AS stop_lon,
	st_y(stop_loc::geometry) AS stop_lat
FROM stops
WHERE (
	stop_id = $1
	OR stop_id LIKE $2
)
AND location_type = ANY(ARRAY['stop', 'station'])
ORDER BY stop_id
LIMIT 2
`,
			values: [
				// We assume IFOPT[0]/DHID[1]-style stop IDs here.
				// By requiring stop IDs to end with the (stripped) HaltID (e.g. `de:12063:900210771` "Rathenow, Bahnhof"), effectively we only obtain stations (stops witout parent).
				// [0] https://en.wikipedia.org/wiki/Identification_of_Fixed_Objects_in_Public_Transport
				// [1] https://www.delfi.de/de/strategie-technik/architektur/
				strippedHaltId,
				`%:${escapeForLikeOp(strippedHaltId)}`,
			],
		})

		if (stops.length === 0) {
			logger.warn({
				ausHaltId,
				strippedHaltId,
			}, 'no GTFS stop found for an AUS HaltID')
			return null
		}
		if (stops.length > 1) {
			logger.warn({
				ausHaltId,
				strippedHaltId,
				gtfsStops: stops,
			}, '>1 GTFS stops found for an AUS HaltID, ignoring ambiguous match')
			return null
		}
		// todo: trace-log?
		return stops[0]
	}

	const cache = new QuickLRU({
		maxSize: 1000,
	})
	const cachedQueryGtfsStopByAusHaltID = async (ausHaltId) => {
		if (cache.has(ausHaltId)) {
			return cache.get(ausHaltId)
		}
		const gtfsStop = await queryGtfsStopByAusHaltID(ausHaltId)
		cache.set(ausHaltId, gtfsStop)
		return gtfsStop
	}

	const stop = async () => {
		await pg.end()
	}

	return {
		uncachedQueryGtfsStopByAusHaltID: queryGtfsStopByAusHaltID,
		queryGtfsStopByAusHaltID: cachedQueryGtfsStopByAusHaltID,
		stop,
	}
}

export {
	stripDataProviderPrefixFromAusHaltID,
	createQueryGtfsStopByAusHaltID,
}
