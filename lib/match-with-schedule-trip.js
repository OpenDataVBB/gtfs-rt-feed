import {createHash} from 'node:crypto'
import {deepStrictEqual} from 'node:assert/strict'
import maxBy from 'lodash/maxBy.js'
import {
	kRouteShortName,
	kScheduledTimeIso8601,
	kFahrtID,
	kUmlaufID,
} from './vdv-aus-istfahrt-as-gtfs-rt-tripupdate.js'
import {
	unixTimestampFromIso8601,
} from './util.js'
import {
	SCHEDULE_RELATIONSHIP_SCHEDULED,
	SCHEDULE_RELATIONSHIP_UNSCHEDULED,
    STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
} from './gtfs-rt.js'
import {
	buildFindScheduleStopTimesQuery as _buildFindScheduleStopTimesQuery,
} from './query-schedule-stop-times.js'
import {
	connectToPostgres,
} from './db.js'
import {createCache} from './caching.js'
import {createQueryStationWeight} from './station-weight.js'
import {mergeTripUpdates} from './merge-tripupdates.js'
import {performance} from 'node:perf_hooks'

const NO_CACHING = process.env.MATCH_GTFS_RT_TO_GTFS_CACHING === 'false'

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
		schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
	}
	return sTU
}

const pickStopTimeUpdatesForMatching = async (cfg, tripUpdate) => {
	const {
		logger,
		queryStationWeight,
		windowSize,
		snapRange,
	} = cfg

	const logCtx = {
		windowSize,
		snapRange,
	}

	const sTUs = tripUpdate.stop_time_update
	const maxI = sTUs.length - 1

	// When deciding which StopTimeUpdates (STUs, a.k.a. stop_times) to pick for matching, we must balance a few aspects to get a set that *reliably* identifies the Schedule trip "instance":
	// - Often, when a trip "instance" has just started (i.e. the vehicle has just served the first few stops), VDV AUS doesn't include IstHalts for later stops. However, we want to match a trip "instance" as early as possible.
	// - Many lines start or end at "Betriebshaltestellen", less important technical/service stops that allow vehicles to park where passengers can board alight, right before/after they serve the important/hub station. – We want to match using important/hub stations rather than "Betriebshaltestellen", given that the latter are sometimes obscure and missing in the data.
	// - Loops in lines are usually small (i.e. a few stops), except loop lines (e.g. S41/S42/S45/S46 in Berlin) which pose a different challenge altogether. In order to reliably distinguish two variants of a line, one with a loop and one without, picking two STUs "far apart" time-wise increases the chance that the loop variant's loop is between them, causing different stop *times*, in turn causing the STUs pair to more reliably tell apart the loop and non-loop variants.
	// - With construction work causing detours/rerouting on a line, we *assume* that pairs of StopTimeUpdates at important/hub stations to more reliably identify the trip Schedule "instance" than pairs of those at less important stops because a) small stops are more likely to be moved/cancelled/re-ID-ed and b) it's still important for rerouted lines to meet connecting lines at certain *unchanged* times.
	// todo: what about true loop lines?
	// todo: add trace-logging – with separate logger?

	const findSTUWithHeighestStationWeight = async (startI, endI) => {
		const candidates = sTUs.slice(startI, endI + 1)
		const weightsRaw = await Promise.all(candidates.map(async (sTU, i) => {
			if (sTU.stop_id) {
				// todo: if not found, fall back to alphanumerical weighting based on 1st char? e.g. by adding 100000 to all other weights
				return [
					startI + i,
					await queryStationWeight(sTU.stop_id),
				]
			}
			return [
				startI + i,
				null,
			]
		}))
		const weights = weightsRaw.filter(([_, weight]) => weight !== null)
		// console.error('weights', {startI, endI, weights}) // todo: remove

		return weights.length > 0
			? maxBy(weights, ([_, weight]) => weight)
			: [startI, null] // no known station weights, fall back to window start index
	}

	// first STU
	let i0WindowStartI = null, i0WindowEndI = null
	let i0 = null
	// pick most important stop among window of STUs
	{
		// - Take a window of `windowSize` items, if possible.
		// - Prefer starting the window with the second STU, as long as the window keeps having `windowSize` items.
		// - Always leave 1 STU for `iN`. – If there are just two STUs in total, we can only use a window (0 0).
		i0WindowEndI = Math.min(windowSize - 1, maxI - 1)
		i0WindowStartI = Math.max(i0WindowEndI - windowSize + 1, 0)

		const [iHighest, weight] = await findSTUWithHeighestStationWeight(i0WindowStartI, i0WindowEndI)
		logCtx.i0WindowIHighest = iHighest
		logCtx.i0WindowWeight = weight
		i0 = iHighest
	}
	logCtx.i0WindowStartI = i0WindowStartI
	logCtx.i0WindowEndI = i0WindowEndI
	logCtx.i0 = i0

	// second STU
	let iNWindowStartI = null, iNWindowEndI = null
	let iN = null
	// pick most important stop among window of STUs, just like with `i0`
	{
		// - Pick a rather high index, but "snap" to `floor(i / n) + n` to stay caching-friendly.
		// - Always start after `i0`.
		// - Take a window of `windowSize` items, if possible.
		// - Prefer ending the window with the second-last STU, as long as the window keeps having `windowSize` items.
		iNWindowStartI = Math.max(Math.floor((maxI - windowSize + 1) / snapRange) * snapRange, i0 + 1)
		iNWindowEndI = Math.min(iNWindowStartI + windowSize - 1, maxI)

		const [iHighest, weight] = await findSTUWithHeighestStationWeight(iNWindowStartI, iNWindowEndI)
		logCtx.inWindowIHighest = iHighest
		logCtx.inWindowWeight = weight
		iN = iHighest
	}
	logCtx.iNWindowStartI = iNWindowStartI
	logCtx.iNWindowEndI = iNWindowEndI
	logCtx.iN = iN

	logger.trace(logCtx, 'picked two StopTimeUpdates for matching')
	return [i0, iN]
}

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

	const {
		queryStationWeight,
		stop: stopQueryingStationWeight,
	} = await createQueryStationWeight()

	const cache = await createCache({
		noCaching: NO_CACHING,
		prefix: 'match',
		ttl: process.env.MATCHING_CACHING_TTL
			? parseInt(process.env.MATCHING_CACHING_TTL) * 1000
			: 24 * 60 * 60 * 1000, // 24 hours
	})

	// todo: expose failure reasons as metrics
	const matchGtfsRtTripUpdateWithScheduleStopTimes = async (tripUpdate) => {
		// todo: add NATS msg seq to help with retroactive debugging?
		const logCtx = {
			kFahrtID: tripUpdate[kFahrtID] ?? null,
			kUmlaufID: tripUpdate[kUmlaufID] ?? null,
		}

		const routeShortName = tripUpdate.trip[kRouteShortName]
		logCtx.routeShortName = routeShortName

		if (tripUpdate.stop_time_update.length.length < 2) {
			logger.warn({
				...logCtx,
			}, 'not trying to match because there are <2 StopTimeUpdates in TripUpdate')
			return {
				tripUpdate,
				isMatched: false,
				isCached: false,
			}
		}

		// todo: fall back to IstFahrt.FahrtStartEnde.{Start,End}{HaltID,zeit}, used by e.g. DB & ODEG:
		// <IstFahrt>
		// 	[…]
		// 	<FahrtRef>
		// 		[…]
		// 		<FahrtStartEnde>
		// 			<StartHaltID>8010397</StartHaltID>
		// 			<Startzeit>2022-06-17T15:04:00+02:00</Startzeit>
		// 			<EndHaltID>900550028</EndHaltID>
		// 			<Endzeit>2022-06-17T16:45:00+02:00</Endzeit>
		// 		</FahrtStartEnde>
		// 	</FahrtRef>
		// 	[…]
		// </IstFahrt>
		// <IstFahrt>
		// 	[…]
		// 	<FahrtRef>
		// 		<FahrtID>
		// 			<FahrtBezeichner>68828#RB#ODEG</FahrtBezeichner>
		// 			<Betriebstag>2022-06-17</Betriebstag>
		// 		</FahrtID>
		// 		<FahrtStartEnde>
		// 			<StartHaltID>900245002</StartHaltID>
		// 			<Startzeit>2022-06-17T16:40:00+02:00</Startzeit>
		// 			<EndHaltID>900053301</EndHaltID>
		// 			<Endzeit>2022-06-17T17:47:00+02:00</Endzeit>
		// 		</FahrtStartEnde>
		// 	</FahrtRef>
		// 	[…]
		// </IstFahrt>

		const [
			iMatchingSTU0,
			iMatchingSTUN,
		] = await pickStopTimeUpdatesForMatching({
			logger,
			queryStationWeight,
			windowSize: 3, // todo: make customisable
			snapRange: 5, // todo: make customisable
		}, tripUpdate)
		const matchingSTU0 = tripUpdate.stop_time_update[iMatchingSTU0]
		if(!matchingSTU0) {
			logger.warn({
				...logCtx,
				iMatchingSTU0,
				matchingSTU0,
			}, `not trying to match because StopTimeUpdate matchingSTU0 (${iMatchingSTU0}) is missing`)
			return {
				tripUpdate,
				isMatched: false,
				isCached: false,
			}
		}
		const matchingSTUN = tripUpdate.stop_time_update[iMatchingSTUN]
		if(!matchingSTUN) {
			logger.warn({
				...logCtx,
				iMatchingSTUN,
				matchingSTUN,
			}, `not trying to match because StopTimeUpdate matchingSTUN (${iMatchingSTUN}) is missing`)
			return {
				tripUpdate,
				isMatched: false,
				isCached: false,
			}
		}
		const stopTimes = [
			[
				'st' + iMatchingSTU0, // alias
				formatStopTimeUpdateAsScheduleStopTime(matchingSTU0),
				{
					stopIdAllowFuzzyIfoptMatching: true,
					timeAllowFuzzyMatching: true,
				},
			],
			[
				'st' + iMatchingSTUN, // alias
				formatStopTimeUpdateAsScheduleStopTime(matchingSTUN),
				{
					stopIdAllowFuzzyIfoptMatching: true,
					timeAllowFuzzyMatching: true,
				},
			],
		]
		logCtx.stopTimes = stopTimes

		// todo: expose cache hit ratio as metric
		// todo: expose DB query & cache read/write times as metrics
		let matchedStopTimes = null
		let isCached = false
		{
			// todo: add Schedule feed version!
			// todo: stable stringifier?
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
		logCtx.gtfsTripId = st0.trip_id
		logCtx.gtfsDate = st0.date

		// todo: this never happens, it fails with `ERROR:  more than one row returned by a subquery used as an expression`
		if (matchedStopTimes.some(st => st.trip_id !== st0.trip_id || st.date !== st0.date)) {
			logger.warn({
				...logCtx,
				matchedStopTimes,
			}, '>1 GTFS Schedule trip "instance", ignoring ambiguous match')
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

		const isFrequenciesBased = st0.frequencies_row >= 0
		const scheduleTripUpdate = {
			trip: {
				route_id: st0.route_id,
				direction_id: st0.direction_id,
				trip_id: st0.trip_id,
				start_date: formatIso8601DateAsGtfsRtDate(st0.date),
				// todo: start_time
				// > Frequency-based trips (GTFS frequencies.txt with exact_times = 0) should not have a SCHEDULED value and should use UNSCHEDULED instead.
				// https://gtfs.org/realtime/reference/#enum-schedulerelationship
				schedule_relationship: isFrequenciesBased
					? SCHEDULE_RELATIONSHIP_UNSCHEDULED
					: SCHEDULE_RELATIONSHIP_SCHEDULED,
			},
			stop_time_update: matchedStopTimes.map(formatScheduleStopTimeAsStopTimeUpdate),
		}

		// merge matchedStopTimes into tripUpdate
		// Note: Both `tripUpdate` and `matchedStopTimes` might contain stop_times/StopTimeUpdates that the other one doesn't contain.
		// We mirror the stop_id/station_id `LIKE` filters in the SQL query above.
		const ausHaltIdMatchesDhid = (ausHaltId, dhid) => {
			const dhidRegex = /^[a-z]{2}:\w+:(\w+)(::?\w+)*$/ig
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
		await stopQueryingStationWeight()
		await cache.stop()
	}

	return {
		matchGtfsRtTripUpdateWithScheduleStopTimes,
		stop,
	}
}

export {
	pickStopTimeUpdatesForMatching,
	createMatchGtfsRtTripUpdateWithScheduleStopTimes,
}
