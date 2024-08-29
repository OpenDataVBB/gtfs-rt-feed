import {strictEqual} from 'node:assert/strict'
import QuickLRU from 'quick-lru'
import {connectToPostgres} from './db.js'
import pick from 'lodash/pick.js'

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
	st_y(stop_loc::geometry) AS stop_lat,
	specificity,
	exact_match
FROM (
		SELECT
			*,
			1 AS specificity,
			True AS exact_match
		FROM stops
		WHERE stop_id LIKE $1
	UNION ALL
		SELECT
			*,
			2 AS specificity,
			False AS exact_match
		FROM stops
		WHERE stop_id LIKE $2
) t
ORDER BY specificity ASC, stop_id ASC
LIMIT 2
`,
			values: [
				// We assume IFOPT[0]/DHID[1]-style stop IDs here.
				// By requiring stop IDs to end with the (stripped) HaltID (e.g. `de:12063:900210771` "Rathenow, Bahnhof"), effectively we only obtain stations (stops witout parent).
				// [0] https://en.wikipedia.org/wiki/Identification_of_Fixed_Objects_in_Public_Transport
				// [1] https://www.delfi.de/de/strategie-technik/architektur/
				// stations with the DHID format `$country:$region:$station_id`:
				`de:%:${strippedHaltId}`,
				// stops/platforms with the DHID format `$country:$region:$station_id:$stop_platform_id`:
				`de:%:${strippedHaltId}:%`,
			],
		})

		if (stops.length === 0) {
			logger.warn({
				ausHaltId,
				strippedHaltId,
			}, 'no GTFS stop/station found for an AUS HaltID')
			return null
		}
		// Effectively, we allow either
		// - 1 exact match; or
		// - >=1 non-exact matches, as long as there's no exact match.
		if (stops.length > 1 && stops[0].exact_match && stops[1].exact_match) {
			logger.warn({
				ausHaltId,
				strippedHaltId,
				gtfsStops: stops,
			}, '>1 GTFS stops/stations found for an AUS HaltID, ignoring ambiguous match')
			return null
		}

		const stop = pick(stops[0], [
			'stop_id',
			'stop_name',
			'stop_lat', 'stop_lon',
		])
		logger.trace({
			ausHaltId,
			strippedHaltId,
			gtfsStops: stops,
		}, 'using most likely GTFS stop/station')
		return stop
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
		queryGtfsStopByAusHaltID: cachedQueryGtfsStopByAusHaltID,
		uncachedQueryGtfsStopByAusHaltID: queryGtfsStopByAusHaltID,
		stop,
	}
}

export {
	stripDataProviderPrefixFromAusHaltID,
	createQueryGtfsStopByAusHaltID,
}
