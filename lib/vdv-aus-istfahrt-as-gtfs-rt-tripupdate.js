import {ok, deepStrictEqual} from 'node:assert/strict'
import {
	stripDataProviderPrefixFromAusHaltID,
} from './gtfs-stop-by-aus-haltid.js'
import { strictEqual } from 'node:assert'

const kRouteShortName = Symbol('GTFS Schedule route_short_name')
const kTimeIso8601 = Symbol('GTFS Realtime StopTimeEvent: time as ISO 8601')
const kScheduledTimeIso8601 = Symbol('GTFS Realtime StopTimeEvent: scheduled time as ISO 8601')

const unixTimestampFromIso8601 = (iso8601) => {
	const unixTimestamp = Date.parse(iso8601) / 1000 | 0
	ok(Number.isInteger(unixTimestamp), 'invalid ISO 8601 string')
	return unixTimestamp
}

const formatIstHaltAsStopTimeEvent = (istHalt, abfahrtAnkunft) => {
	const plannedIso = istHalt[`${abfahrtAnkunft}szeit`] || null
	if (plannedIso === null) {
		return null
	}
	const planned = unixTimestampFromIso8601(plannedIso)
	const prognosedIso = istHalt[`Ist${abfahrtAnkunft}Prognose`] || null

	let time = planned
	let timeIso = plannedIso
	let delay = null
	if (prognosedIso) {
		const prognosed = unixTimestampFromIso8601(prognosedIso)
		delay = Math.round(prognosed - planned)
		time = prognosed
		timeIso = prognosedIso
	}

	const stopTimeEvent = {
		time,
		delay,
	}
	Object.defineProperty(stopTimeEvent, kTimeIso8601, {value: timeIso})
	Object.defineProperty(stopTimeEvent, kScheduledTimeIso8601, {value: plannedIso})
	return stopTimeEvent
}
{
	const istHalt1 = {
		Ankunftszeit: '2022-06-17T16:38:00+02:00',
		Abfahrtszeit: '2022-06-17T16:39:00+02:00',
		IstAnkunftPrognose: '2022-06-17T14:37:20Z',
		IstAbfahrtPrognose: null,
	}

	const arrival1 = formatIstHaltAsStopTimeEvent(istHalt1, 'Ankunft')
	deepStrictEqual(arrival1, {
		time: Date.parse('2022-06-17T16:37:20+02:00') / 1000 | 0,
		delay: -40,
	})
	strictEqual(arrival1[kTimeIso8601], '2022-06-17T14:37:20Z')
	strictEqual(arrival1[kScheduledTimeIso8601], '2022-06-17T16:38:00+02:00')

	const departure1 = formatIstHaltAsStopTimeEvent(istHalt1, 'Abfahrt')
	deepStrictEqual(departure1, {
		time: Date.parse('2022-06-17T16:39:00+02:00') / 1000 | 0,
		delay: null,
	})
	strictEqual(departure1[kTimeIso8601], '2022-06-17T16:39:00+02:00')
	strictEqual(departure1[kScheduledTimeIso8601], '2022-06-17T16:39:00+02:00')
}

const formatVdvAusIstHaltAsGtfsRtStopTimeUpdate = (istHalt) => {
	const stop_id = stripDataProviderPrefixFromAusHaltID(istHalt.HaltID) || null

	const stopTimeUpdate = {
		stop_id,

		arrival: formatIstHaltAsStopTimeEvent(istHalt, 'Ankunft'),
		departure: formatIstHaltAsStopTimeEvent(istHalt, 'Abfahrt'),
	}

	return stopTimeUpdate
}

const createFormatVdvAusIstFahrtAsGtfsRtTripUpdate = async (cfg) => {
	const {
		logger,
	} = cfg

	const formatVdvAusIstFahrtAsGtfsRtTripUpdate = (istFahrt) => {
		// some samples from VBB's VDV-453/-454 endpoint:
		// - HVG's 687 bus: {
		// 	LinienID: 'HVG687',
		// 	LinienText: '687',
		// 	RichtungsID: 'HVG687A',
		// 	RichtungsText: 'Friesack',
		// 	FahrtID: {FahrtBezeichner: '13865-00024-1#HVG', Betriebstag: '2024-06-27'},
		// 	UmlaufID: '79274',
		// 	[…]
		// 	IstHalts: [{
		// 		HaltID: 'ODEG_900210771',
		// 		[…]
		// 	}],
		// 	[…]
		// }
		// - BVG's U8: {
		// 	LinienID: 'U8',
		// 	LinienText: 'U8',
		// 	RichtungsID: '1',
		// 	RichtungsText: null,
		// 	FahrtID: {FahrtBezeichner: '260624_0601WIUHMS#BVG', Betriebstag: '2024-06-26'},
		// 	Komplettfahrt: 'false',
		// 	UmlaufID: null,
		// 	[…]
		// 	IstHalts: [{
		// 		HaltID: 'ODEG_900007103',
		// 	}],
		// 	[…]
		// }

		// The AUS LinienIDs do not cleanly map to GTFS concepts because
		// - the AUS LinienIDs are prefixed by the operator's abbreviation (e.g. "HVG"), whereas the GTFS agency's name is usually unabbreviated (e.g. "Havelbus Verkehrsgesellschaft mbH");
		// - the AUS LinienText is not unique enough – there might be >1 "12" buses in the entire dataset.
		// The FahrtID is usually proprietary (e.g. `13865-00024-1#HVG`) and therefore doesn't match the GTFS trip_id.
		// To still be able to match the IstFahrt, we collect enough information to be able to uniquely match it with a GTFS Schedule trip "instance".

		const tripUpdate = {
			// todo: TripUpdate.timestamp using istFahrt.Zst – probably vdv-453-nats-adapter needs to be changed

			trip: {
				// todo
			},

			stop_time_update: istFahrt.IstHalts.map(formatVdvAusIstHaltAsGtfsRtStopTimeUpdate),
		}

		// not part of the GTFS Realtime spec, we just use it for matching
		const route_short_name = istFahrt.LinienText || null
		Object.defineProperty(tripUpdate.trip, kRouteShortName, {value: route_short_name})
		return tripUpdate
	}

	return {
		formatVdvAusIstFahrtAsGtfsRtTripUpdate,
	}
}

export {
	kRouteShortName,
	kTimeIso8601,
	kScheduledTimeIso8601,
	unixTimestampFromIso8601,
	createFormatVdvAusIstFahrtAsGtfsRtTripUpdate,
}