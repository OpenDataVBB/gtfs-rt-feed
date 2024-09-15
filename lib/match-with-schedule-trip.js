import {createHash} from 'node:crypto'
import {deepStrictEqual} from 'node:assert/strict'
import {DateTime} from 'luxon'
import {
	kRouteShortName,
	kScheduledTimeIso8601,
	unixTimestampFromIso8601,
} from './vdv-aus-istfahrt-as-gtfs-rt-tripupdate.js'
import {
	connectToPostgres,
	escapeForLikeOp,
} from './db.js'
import {createCache} from './caching.js'
import {mergeTripUpdates} from './merge-tripupdates.js'
import {performance} from 'node:perf_hooks'

const sha256AsHex = (data) => {
	const hash = createHash('sha256')
	hash.update(data)
	return hash.digest('hex')
}

const formatIso8601DateAsGtfsRtDate = (isoDate) => {
	return `${isoDate.slice(0, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}`
}
deepStrictEqual(formatIso8601DateAsGtfsRtDate('2024-09-15'), '20240915')

const formatStopTimeUpdateAsScheduleStopTime = (sTU) => {
	return {
		stop_id: sTU.stop_id,
		t_arrival: sTU.arrival?.[kScheduledTimeIso8601] || null,
		t_departure: sTU.departure?.[kScheduledTimeIso8601] || null,
	}
}

// this mirrors formatIstHaltAsStopTimeEvent() & formatVdvAusIstHaltAsGtfsRtStopTimeUpdate() in vdv-aus-istfahrt-as-gtfs-rt-tripupdate.js
const formatScheduleStopTimeAsStopTimeUpdate = (st) => {
	let arrival = null
	if (st.arrival !== null) {
		const time = unixTimestampFromIso8601(st.t_arrival)
		arrival = {
			time,
			delay: null,
		}
		Object.defineProperty(arrival, kScheduledTimeIso8601, {value: time})
	}
	let departure = null
	if (st.departure !== null) {
		const time = unixTimestampFromIso8601(st.t_departure)
		departure = {
			time,
			delay: null,
		}
		Object.defineProperty(departure, kScheduledTimeIso8601, {value: time})
	}
	const sTU = {
		stop_sequence: st.stop_sequence,
		stop_id: st.stop_id,
		arrival,
		departure,
	}
	return sTU
}

const _buildFindScheduleStopTimesQuery = (cfg) => {
	const {
		routeShortName,
		stopTimes,
	} = cfg

	let query = `\
WITH
`
	let params = []
	let paramsI = 1

	// computer filters for applied to all stopTimes
	let genericFilters = ''
	if (routeShortName !== null) {
		genericFilters += `\
		AND route_short_name = $${paramsI++}
`
		params.push(routeShortName)
	}

	let firstCte = true
	for (const [alias, stopTime, cfg] of stopTimes) {
		const {
			stopIdAllowFuzzyIfoptMatching,
			timeAllowFuzzyMatching,
		} = cfg

		query += `\
	${firstCte ? '' : ', '}${alias} AS NOT MATERIALIZED (
		SELECT
			trip_id,
			"date",
			stop_sequence_consec
		FROM arrivals_departures ad
		WHERE True
${genericFilters}
`

		// filter by stop/station ID
		{
			const {stop_id} = stopTime
			const stopIdParamsI = paramsI++
			query += `\
		AND (
			stop_id = $${stopIdParamsI}
			OR station_id = $${stopIdParamsI}
`
			params.push(stop_id)

			if (stopIdAllowFuzzyIfoptMatching) {
				// We assume IFOPT[0]/DHID[1]-style stop IDs here.
				// By requiring Schedule stop IDs to end with the provided ID (e.g. `900210771` for `de:12063:900210771` "Rathenow, Bahnhof"), effectively we only obtain stations (stops witout parent).
				// [0] https://en.wikipedia.org/wiki/Identification_of_Fixed_Objects_in_Public_Transport
				// [1] https://www.delfi.de/de/strategie-technik/architektur/
				query += `\
			OR station_id LIKE $${paramsI++}
			OR stop_id LIKE $${paramsI++}
`
				params.push(`%:${escapeForLikeOp(stop_id)}`)
				params.push(`%:${escapeForLikeOp(stop_id)}%`)
			}
			query += `\
		)
`
		}

		// filter by t_arrival/t_departure
		{
			const whenColName = stopTime.t_departure ? 't_departure' : 't_arrival'
			const when = stopTime.t_departure ?? stopTime.t_arrival

			if (timeAllowFuzzyMatching) {
				const whenMin = DateTime.fromISO(when)
				.minus({minutes: 1})
				.toISO({suppressMilliseconds: true})
				const whenMax = DateTime.fromISO(when)
				.plus({minutes: 1})
				.toISO({suppressMilliseconds: true})
				const whenMinParamsI = paramsI++
				const whenMaxParamsI = paramsI++
				query += `\
		AND ${whenColName} >= $${whenMinParamsI}
		AND ${whenColName} <= $${whenMaxParamsI}
		-- see https://github.com/public-transport/gtfs-via-postgres/blob/4.10.2/readme.md#correctness-vs-speed-regarding-gtfs-time-values
		AND "date" >= dates_filter_min($${whenMinParamsI}::timestamp with time zone)
		AND "date" <= dates_filter_max($${whenMaxParamsI}::timestamp with time zone)
`
				params.push(whenMin)
				params.push(whenMax)
			} else {
				const whenParamsI = paramsI++
				query += `\
		AND ${whenColName} = $${whenParamsI}
		-- see https://github.com/public-transport/gtfs-via-postgres/blob/4.10.2/readme.md#correctness-vs-speed-regarding-gtfs-time-values
		AND "date" >= dates_filter_min($${whenParamsI}::timestamp with time zone)
		AND "date" <= dates_filter_max($${whenParamsI}::timestamp with time zone)
`
				params.push(when)
			}
		}

		query += `\
	)
`
		firstCte = false
	}

	{
		const [alias0] = stopTimes[0]
		query += `\
	, matches AS NOT MATERIALIZED (
		SELECT DISTINCT ON (${alias0}.trip_id, ${alias0}.date)
			${alias0}.*
		FROM ${alias0}
`
		// Note: We're starting with the 2nd stop_time!
		for (let i = 1; i < stopTimes.length; i++) {
			const [alias] = stopTimes[i]
			const [prevAlias] = stopTimes[i - 1]
			query += `\
		INNER JOIN ${alias} ON (
			${alias}.trip_id = ${prevAlias}.trip_id
			AND ${alias}.date = ${prevAlias}.date
			AND ${alias}.stop_sequence_consec > ${prevAlias}.stop_sequence_consec
		)
`
		}
		query += `\
		LIMIT 2
`
	}

	query += `\
	)
SELECT
	route_id,
	direction_id,
	ad.trip_id,
	(ad.date::date)::text AS "date",
	stop_sequence,
	stop_id,
	t_arrival,
	t_departure
FROM arrivals_departures ad
WHERE True
-- We can't use a mere \`trip_id = ANY(SELECT trip_id FROM matches)\` because, as of v14, PostgreSQL fails to "push down" the join/filtering [2] into \`arrivals_departures\` even though \`matches\` is materialized and known to be small. By forcing PostgreSQL to "collect" the values from \`matches\` using \`array()\` [0][1], we guide it to todo. (The same applies to \`date\`.)
-- This technique *does not* work (i.e. is slow) when using \`IN\` to filter with (trip_id, date) pairs – using two separate \`= ANY()\` filters is not equivalent, after all! –, so we first filter using \`= ANY()\` on trip_id & date for speed, and then filter on the pairs for correctness.
-- [0] https://stackoverflow.com/a/15007154/1072129
-- [1] https://dba.stackexchange.com/a/189255/289704
-- [2] https://stackoverflow.com/a/66626205/1072129
AND ad.trip_id = ANY(array(SELECT trip_id FROM matches))
AND ad.date = ANY(array(SELECT "date" FROM matches))
AND (ad.trip_id, ad.date) IN (
	SELECT *
	FROM unnest(
		array(SELECT trip_id FROM matches),
		array(SELECT "date" FROM matches)
	) AS t(trip_id, "date")
)
ORDER BY trip_id, "date", stop_sequence_consec
`

	return {
		query,
		params,
	}
}

deepStrictEqual(
	_buildFindScheduleStopTimesQuery({
		stopTimes: [
			[
				'st_0',
				{
					stop_id: '900079221',
					t_departure: '2024-06-27T13:27:00+02:00',
				},
				{
					stopIdAllowFuzzyIfoptMatching: true,
					timeAllowFuzzyMatching: true,
				},
			],
			[
				'st_1',
				{
					stop_id: '900079201',
					t_arrival: '2024-06-27T11:29:00Z',
				},
				{
					stopIdAllowFuzzyIfoptMatching: false,
					timeAllowFuzzyMatching: true,
				},
			],
			[
				'st_n',
				{
					stop_id: '900009202',
					t_arrival: '2024-06-27T13:53:00+02:00',
				},
				{
					stopIdAllowFuzzyIfoptMatching: false,
					timeAllowFuzzyMatching: false,
				},
			],
		],
		routeShortName: 'U8',
	}),
	{
		query: `\
WITH
	st_0 AS NOT MATERIALIZED (
		SELECT
			trip_id,
			"date",
			stop_sequence_consec
		FROM arrivals_departures ad
		WHERE True
		AND route_short_name = $1

		AND (
			stop_id = $2
			OR station_id = $2
			OR station_id LIKE $3
			OR stop_id LIKE $4
		)
		AND t_departure >= $5
		AND t_departure <= $6
		-- see https://github.com/public-transport/gtfs-via-postgres/blob/4.10.2/readme.md#correctness-vs-speed-regarding-gtfs-time-values
		AND "date" >= dates_filter_min($5::timestamp with time zone)
		AND "date" <= dates_filter_max($6::timestamp with time zone)
	)
	, st_1 AS NOT MATERIALIZED (
		SELECT
			trip_id,
			"date",
			stop_sequence_consec
		FROM arrivals_departures ad
		WHERE True
		AND route_short_name = $1

		AND (
			stop_id = $7
			OR station_id = $7
		)
		AND t_arrival >= $8
		AND t_arrival <= $9
		-- see https://github.com/public-transport/gtfs-via-postgres/blob/4.10.2/readme.md#correctness-vs-speed-regarding-gtfs-time-values
		AND "date" >= dates_filter_min($8::timestamp with time zone)
		AND "date" <= dates_filter_max($9::timestamp with time zone)
	)
	, st_n AS NOT MATERIALIZED (
		SELECT
			trip_id,
			"date",
			stop_sequence_consec
		FROM arrivals_departures ad
		WHERE True
		AND route_short_name = $1

		AND (
			stop_id = $10
			OR station_id = $10
		)
		AND t_arrival = $11
		-- see https://github.com/public-transport/gtfs-via-postgres/blob/4.10.2/readme.md#correctness-vs-speed-regarding-gtfs-time-values
		AND "date" >= dates_filter_min($11::timestamp with time zone)
		AND "date" <= dates_filter_max($11::timestamp with time zone)
	)
	, matches AS NOT MATERIALIZED (
		SELECT DISTINCT ON (st_0.trip_id, st_0.date)
			st_0.*
		FROM st_0
		INNER JOIN st_1 ON (
			st_1.trip_id = st_0.trip_id
			AND st_1.date = st_0.date
			AND st_1.stop_sequence_consec > st_0.stop_sequence_consec
		)
		INNER JOIN st_n ON (
			st_n.trip_id = st_1.trip_id
			AND st_n.date = st_1.date
			AND st_n.stop_sequence_consec > st_1.stop_sequence_consec
		)
		LIMIT 2
	)
SELECT
	route_id,
	direction_id,
	ad.trip_id,
	(ad.date::date)::text AS "date",
	stop_sequence,
	stop_id,
	t_arrival,
	t_departure
FROM arrivals_departures ad
WHERE True
-- We can't use a mere \`trip_id = ANY(SELECT trip_id FROM matches)\` because, as of v14, PostgreSQL fails to "push down" the join/filtering [2] into \`arrivals_departures\` even though \`matches\` is materialized and known to be small. By forcing PostgreSQL to "collect" the values from \`matches\` using \`array()\` [0][1], we guide it to todo. (The same applies to \`date\`.)
-- This technique *does not* work (i.e. is slow) when using \`IN\` to filter with (trip_id, date) pairs – using two separate \`= ANY()\` filters is not equivalent, after all! –, so we first filter using \`= ANY()\` on trip_id & date for speed, and then filter on the pairs for correctness.
-- [0] https://stackoverflow.com/a/15007154/1072129
-- [1] https://dba.stackexchange.com/a/189255/289704
-- [2] https://stackoverflow.com/a/66626205/1072129
AND ad.trip_id = ANY(array(SELECT trip_id FROM matches))
AND ad.date = ANY(array(SELECT "date" FROM matches))
AND (ad.trip_id, ad.date) IN (
	SELECT *
	FROM unnest(
		array(SELECT trip_id FROM matches),
		array(SELECT "date" FROM matches)
	) AS t(trip_id, "date")
)
ORDER BY trip_id, "date", stop_sequence_consec
`,
		params: [
			'U8',
			'900079221',
			'%:900079221',
			'%:900079221%',
			'2024-06-27T13:26:00+02:00',
			'2024-06-27T13:28:00+02:00',
			'900079201',
			'2024-06-27T13:28:00+02:00',
			'2024-06-27T13:30:00+02:00',
			'900009202',
			'2024-06-27T13:53:00+02:00',
		],
	},
)

const createMatchGtfsRtTripUpdateWithScheduleStopTimes = async (cfg, opt = {}) => {
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

	const cache = await createCache()

	const matchGtfsRtTripUpdateWithScheduleStopTimes = async (tripUpdate) => {
		const logCtx = {}

		const routeShortName = tripUpdate.trip[kRouteShortName]
		logCtx.routeShortName = routeShortName
		const lastI = tripUpdate.stop_time_update.length - 1
		const stopTimes = [
			[
				'st0', // alias
				formatStopTimeUpdateAsScheduleStopTime(tripUpdate.stop_time_update[0]),
				{
					stopIdAllowFuzzyIfoptMatching: true,
					timeAllowFuzzyMatching: true,
				},
			],
			[
				'st' + lastI, // alias
				formatStopTimeUpdateAsScheduleStopTime(tripUpdate.stop_time_update[lastI]),
				{
					stopIdAllowFuzzyIfoptMatching: true,
					timeAllowFuzzyMatching: true,
				},
			],
		]

		let matchedStopTimes = null
		let isCached = false
		{
			const cacheId = sha256AsHex(JSON.stringify(stopTimes))

			// read from cache
			const t0 = performance.now()
			const matchedStopTimesFromCache = await cache.get(cacheId)
			const cacheReadTime = performance.now() - t0
			logCtx.cacheReadTime = +cacheReadTime.toFixed(2)

			if (matchedStopTimesFromCache !== null) {
				matchedStopTimes = matchedStopTimesFromCache
				isCached = true
				logger.debug({
					...logCtx,
				}, 'read matching GTFS Schedule trip "instance" from cache')
			} else {
				const t0 = performance.now()
				const {
					query,
					params,
				} = _buildFindScheduleStopTimesQuery({
					routeShortName,
					stopTimes,
				})

				// query DB
				const {
					rows,
				} = await pg.query({
					text: query,
					values: params,
				})
				const dbQueryTime = performance.now() - t0
				logCtx.dbQueryTime = +dbQueryTime.toFixed(2)

				matchedStopTimes = rows

				// write to cache
				const t1 = performance.now()
				await cache.put(cacheId, matchedStopTimes)
				const cacheWriteTime = performance.now() - t1
				logCtx.cacheWriteTime = +cacheWriteTime.toFixed(2)
			}
		}

		if (matchedStopTimes.length === 0) {
			logger.warn({
				...logCtx,
			}, 'no matching GTFS Schedule trip "instance" found')
			return {
				tripUpdate,
				isMatched: false,
				isCached,
			}
		}
		const [st0] = matchedStopTimes
		// todo: this never happens, it fails with `ERROR:  more than one row returned by a subquery used as an expression`
		if (matchedStopTimes.some(st => st.trip_id !== st0.trip_id || st.date !== st0.date)) {
			logger.warn({
				...logCtx,
				matchedStopTimes,
			}, '>1 GTFS Schedule trip, ignoring ambiguous match')
			return {
				tripUpdate,
				isMatched: false,
				isCached,
			}
		}
		logger.trace({
			...logCtx,
			noOfMatchedStopTimes: matchedStopTimes.length,
		}, 'found matching GTFS Schedule trip "instance"')

		const scheduleTripUpdate = {
			trip: {
				route_id: st0.route_id,
				direction_id: st0.direction_id,
				trip_id: st0.trip_id,
				start_date: formatIso8601DateAsGtfsRtDate(st0.date),
				// todo: start_time
			},
			stop_time_update: matchedStopTimes.map(formatScheduleStopTimeAsStopTimeUpdate),
		}

		// merge matchedStopTimes into tripUpdate
		// Note: Both `tripUpdate` and `matchedStopTimes` might contain stop_times/StopTimeUpdates that the other one doesn't contain.
		// We mirror the stop_id/station_id `LIKE` filters in the SQL query above.
		const ausHaltIdMatchesDhid = (ausHaltId, dhid) => {
			const dhidRegex = /^[a-z]{2}:\w+:(\w+)(::?\w+)?$/ig
			const m = dhidRegex.exec(dhid)
			return m ? m[1] === ausHaltId : false
		}
		const stopIdsAreEqual = (stopIdA, stopIdB) => {
			return (
				ausHaltIdMatchesDhid(stopIdA, stopIdB)
				|| ausHaltIdMatchesDhid(stopIdB, stopIdA)
			)
		}
		const mergedTripUpdate = mergeTripUpdates(scheduleTripUpdate, tripUpdate, {
			stopIdsAreEqual,
			timeAllowFuzzyMatching: true,
		})
		return {
			tripUpdate: mergedTripUpdate,
			isMatched: true,
			isCached, // todo: re-implement caching?
		}
	}

	const stop = async () => {
		await pg.end()
	}

	return {
		matchGtfsRtTripUpdateWithScheduleStopTimes,
		stop,
	}
}

export {
	createMatchGtfsRtTripUpdateWithScheduleStopTimes,
}
