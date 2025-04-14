import isObject from 'lodash/isObject.js'
import mergeWith from 'lodash/mergeWith.js'
import {
	fail,
	deepStrictEqual,
} from 'node:assert/strict'
import {
	kRouteShortName,
} from './vdv-aus-istfahrt-as-gtfs-rt-tripupdate.js'

const TIME_MATCHING_MAX_DEVIATION = 60 // seconds

// Merges objects deeply, but only lets entries of later objects overwrite those of former ones if the later ones are null or undefined.
const mergeButIgnoreNull = (...objs) => {
	return mergeWith(
		{},
		...objs,
		(formerVal, laterVal) => {
			return isObject(laterVal)
				? mergeButIgnoreNull(formerVal, laterVal)
				: (laterVal ?? formerVal)
		},
	)
}
deepStrictEqual(
	mergeButIgnoreNull({
		foo: 1,
		bar: 2,
		baz: {_: null},
	}, {
		foo: null,
		bar: 3,
		baz: {_: 4},
	}),
	{
		foo: 1,
		bar: 3,
		baz: {_: 4},
	},
)

const scheduledTime = (stopTimeEvent) => {
	return Number.isInteger(stopTimeEvent?.time)
		? stopTimeEvent.time - (stopTimeEvent.delay ?? 0)
		: null
}

const stopTimeUpdatesAreEquivalent = (sTU1, opt = {}) => (sTU2) => {
	const {
		stopIdsAreEqual,
		stopTimeEventsAreEqual,
	} = {
		stopIdsAreEqual: (stopIdA, stopIdB) => stopIdA === stopIdB,
		stopTimeEventsAreEqual: (sTEA, sTEB) => scheduledTime(sTEA) === scheduledTime(sTEB),
		...opt,
	}

	const equalStopSequences = Number.isInteger(sTU1.stop_sequence) && Number.isInteger(sTU2.stop_sequence) && sTU1.stop_sequence === sTU2.stop_sequence
	const equalStopIds = stopIdsAreEqual(sTU1.stop_id, sTU2.stop_id)
	const equalSchedArr = scheduledTime(sTU1.arrival) !== null && stopTimeEventsAreEqual(sTU1.arrival, sTU2.arrival)
	const equalSchedDep = scheduledTime(sTU1.departure) !== null && stopTimeEventsAreEqual(sTU1.departure, sTU2.departure)
	return equalStopSequences || (equalStopIds && (equalSchedArr || equalSchedDep))
}

const mergeStopTimeEvents = (schedSTE, rtSTE) => {
	const sTE = rtSTE ?? schedSTE ?? null
	return sTE
}
const mergeStopTimeUpdates = (schedSTU, rtSTU) => {
	const sTU = {
		...mergeButIgnoreNull(schedSTU, rtSTU),
		// always prefer schedule stop_id
		stop_id: schedSTU.stop_id ?? rtSTU.stop_id ?? null,
		arrival: mergeStopTimeEvents(schedSTU.arrival, rtSTU.arrival),
		departure: mergeStopTimeEvents(schedSTU.departure, rtSTU.departure),
	}
	return sTU
}
deepStrictEqual(
	mergeStopTimeUpdates({
		stop_sequence: 12,
		stop_id: 'some-schedule-id',
		arrival: null,
		departure: {time: 2345, delay: null},
	}, {
		stop_id: 'some-realtime-id',
		arrival: {time: 1234, delay: 0},
		departure: {time: 2344, delay: -1},
	}),
	{
		stop_sequence: 12,
		stop_id: 'some-schedule-id',
		arrival: {time: 1234, delay: 0},
		departure: {time: 2344, delay: -1},
	},
)

const combineStopTimeUpdates = (schedSTUs, rtSTUs, opt = {}) => {
	const merged = []
	let rtSTUsI = 0, schedSTUsI = 0
	while (true) {
		// There are no more realtime/schedule STUs (respectively), so we just pick all others.
		if (rtSTUsI >= rtSTUs.length) {
			const remainingSchedSTUs = schedSTUs.slice(schedSTUsI)
			merged.push(...remainingSchedSTUs)
			schedSTUsI += remainingSchedSTUs.length
			break
		}
		if (schedSTUsI >= schedSTUs.length) {
			const remainingRtSTUs = rtSTUs.slice(rtSTUsI)
			merged.push(...remainingRtSTUs)
			rtSTUsI += remainingRtSTUs.length
			break
		}

		const rtSTU = rtSTUs[rtSTUsI]
		const schedSTU = schedSTUs[schedSTUsI]
		if (!rtSTU && !schedSTU) {
			break // done!
		}
 
		if (stopTimeUpdatesAreEquivalent(schedSTU, opt)(rtSTU)) {
			merged.push(mergeStopTimeUpdates(schedSTU, rtSTU))
			schedSTUsI++
			rtSTUsI++
			continue
		}
 
		const iMatchingSchedSTU = schedSTUs.slice(schedSTUsI).findIndex(stopTimeUpdatesAreEquivalent(rtSTU, opt))
		const iMatchingRtSTU = rtSTUs.slice(rtSTUsI).findIndex(stopTimeUpdatesAreEquivalent(schedSTU, opt))

		if (iMatchingRtSTU > 0) {
			// There's a realtime STU matching the current schedule STU, but it is some items after the current (realtime) one. So we take the unmatched schedule STU first.
			merged.push(rtSTU)
			rtSTUsI++
			continue
		}
		if (iMatchingSchedSTU > 0) {
			// There's a schedule STU matching the current realtime STU, but it is some items after the current (schedule) one. So we take the unmatched realtime STU first.
			merged.push(schedSTU)
			schedSTUsI++
			continue
		}
		if (iMatchingRtSTU < 0) {
			// The current schedule STU has no matching (realtime) STU, so we take it as-is.
			merged.push(schedSTU)
			schedSTUsI++
			continue
		}
		if (iMatchingSchedSTU < 0) {
			// The current realtime STU has no matching (schedule) STU, so we take it as-is.
			merged.push(rtSTU)
			rtSTUsI++
			continue
		}
		fail('unexpected state')
		break
	}
	return merged
}

deepStrictEqual(
	combineStopTimeUpdates(
		[ // schedSTUs
			// A missing
			{
				stop_sequence: 2,
				stop_id: 'B',
				arrival: {time: 2000},
				departure: {time: 3000},
			},
			// C missing
			{
				stop_sequence: 4, // gap of 1, on purpose
				stop_id: 'D ', // note the space
				arrival: {time: 6000},
				departure: {time: 7000},
			},
			{
				stop_sequence: 5,
				stop_id: 'E',
				// 0s dwelling, on purpose
				arrival: {time: 8000},
				departure: {time: 8000},
			},
			// F missing
			// G missing
		],
		[ // rtSTUs
			{
				stop_id: 'A',
				departure: {time: 1000},
			},
			{
				stop_id: 'B',
				arrival: {time: 2100, delay: 100},
				departure: {time: 3050, delay: 50},
			},
			{
				stop_id: 'C',
				arrival: {time: 4000},
				departure: {time: 5010, delay: 10},
			},
			{
				stop_id: ' D', // note the space
				arrival: {time: 6000, delay: 0},
				departure: {time: 7020, delay: 20},
			},
			// E missing
			{
				stop_id: 'F',
				arrival: {time: 8980, delay: -20},
				departure: {time: 10010, delay: 10},
			},
			{
				stop_id: 'G',
				arrival: {time: 10080, delay: -20},
			},
		],
		{
			stopIdsAreEqual: (stopIdA, stopIdB) => stopIdA.trim() === stopIdB.trim(),
		},
	),
	[
		{
			stop_id: 'A',
			departure: {time: 1000},
		},
		{
			stop_sequence: 2,
			stop_id: 'B',
			arrival: {time: 2100, delay: 100},
			departure: {time: 3050, delay: 50},
		},
		{
			stop_id: 'C',
			arrival: {time: 4000},
			departure: {time: 5010, delay: 10},
		},
		{
			stop_sequence: 4,
			stop_id: 'D ', // note the space
			arrival: {time: 6000, delay: 0},
			departure: {time: 7020, delay: 20},
		},
		{
			stop_sequence: 5,
			stop_id: 'E',
			arrival: {time: 8000},
			departure: {time: 8000},
		},
		{
			stop_id: 'F',
			arrival: {time: 8980, delay: -20},
			departure: {time: 10010, delay: 10},
		},
		{
			stop_id: 'G',
			arrival: {time: 10080, delay: -20},
		},
	],
)

const mergeTripUpdates = (schedTU, rtTU, opt = {}) => {
	const {
		timeAllowFuzzyMatching,
	} = {
		timeAllowFuzzyMatching: false,
		...opt,
	}

	if (timeAllowFuzzyMatching) {
		opt = {
			...opt,
			stopTimeEventsAreEqual: (sTEA, sTEB) => {
				const diff = scheduledTime(sTEA) - scheduledTime(sTEB) // seconds
				return Number.isFinite(diff) ? Math.abs(diff) <= TIME_MATCHING_MAX_DEVIATION : false
			}
		}
	}

	const tU = mergeButIgnoreNull(schedTU, rtTU)
	tU.stop_time_update = combineStopTimeUpdates(
		schedTU.stop_time_update,
		rtTU.stop_time_update,
		opt,
	)

	if (kRouteShortName in schedTU.trip) {
		Object.defineProperty(tU.trip, kRouteShortName, {
			value: schedTU.trip[kRouteShortName],
		})
	}
	return tU
}

export {
	mergeTripUpdates,
}
