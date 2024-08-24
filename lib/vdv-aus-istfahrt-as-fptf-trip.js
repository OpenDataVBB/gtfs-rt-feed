import slugg from 'slugg'
import omit from 'lodash/omit.js'
import OPERATORS from './operators.js'
import {
	createQueryGtfsStopByAusHaltID,
	stripDataProviderPrefixFromAusHaltID,
} from './gtfs-stop-by-aus-haltid.js'

const normalizeOpName = (opName) => {
	return slugg(opName.trim())
}

// todo: write tests
const operatorFromVdvAusIstFahrt = (istFahrt) => {
	// Try to find the operator using…

	// … the BetreiberID (e.g. `Strausberger Eisenbahn GmbH`), which always seems to match the GTFS Schedule agency_name if available.
	if (istFahrt.BetreiberID) {
		const op = OPERATORS.find((op) => {
			return normalizeOpName(op.gtfsAgencyName) === normalizeOpName(istFahrt.BetreiberID)
		})
		if (op) {
			// todo: trace-log?
			return op
		}
	}

	// … the LinienID if it seems to be an IFOPT[0]-style DLID/DTID[1][2] (e.g. `de:vtf:757`).
	// [0] https://en.wikipedia.org/wiki/Identification_of_Fixed_Objects_in_Public_Transport
	// [1] https://www.vdv.de/20200402-delfi-dlid-dtid-anpassungkonvention-v02.pptx-schreibgeschuetzt.pdfx
	// [2] https://www.vdv.de/downloads/5167/433%20%20SDK/forced
	// DLID/DTID structure: `$country:$operator:$lineId`
	const dlidRegex = /^[a-z]{2}:(\w+):.+/i
	if (istFahrt.LinienID && dlidRegex.test(istFahrt.LinienID)) {
		const [_, opShortName] = dlidRegex.test(istFahrt.LinienID)
		const op = OPERATORS.find((op) => {
			return op.ausLinienIdOperatorPart === opShortName
		})
		if (op) {
			// todo: trace-log?
			return op
		}
	}

	// … the FahrtBezeichner's suffix (e.g. `6467-00065-1#HVG`).
	if (istFahrt.FahrtID?.FahrtBezeichner) {
		const parts = istFahrt.FahrtID?.FahrtBezeichner.split('#')
		const opShortName = parts.length >= 2 ? parts.at(-1) : null
		if (opShortName) {
			const op = OPERATORS.find((op) => {
				return op.ausFahrtBezeichnerSuffix === opShortName
			})
			if (op) {
				// todo: trace-log?
				return op
			}
		}
	}

	// todo: debug-log
	return null
}

// As of version 7, match-gtfs-rt-to-gtfs expects a trip in the FPTF format, which is not precisely defined, so we use the draft FPTF v2 spec [1] and hafas-client's format [2] as a reference.
// [1] https://github.com/public-transport/friendly-public-transport-format/tree/3bd36faa721e85d9f5ca58fb0f38cdbedb87bbca/spec
// [2] https://github.com/public-transport/hafas-client/blob/65096a85b69628c5fef03f35bd2ac816e8ce7f89/docs/trip.md
// todo: make match-gtfs-rt-to-gtfs accept GTFS-style or GTFS-RT-formatted trips instead
const createFormatVdvAusIstFahrtAsFptfTrip = async (cfg) => {
	const {
		logger,
	} = cfg

	const {
		queryGtfsStopByAusHaltID,
		stop,
	} = await createQueryGtfsStopByAusHaltID(cfg)

	const formatVdvAusIstFahrtAsFptfTrip = async (istFahrt) => {
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

		// With the matching logic of match-gtfs-rt-to-gtfs@7, using just the line ID for matching is almost always not sufficient, because
		// - the AUS LinienIDs are prefixed by the operator's abbreviation (e.g. "HVG"), whereas the GTFS Schedule agency's name is usually unabbreviated (e.g. "Havelbus Verkehrsgesellschaft mbH");
		// - the AUS LinienText is not unique enough – there might be >1 "12" buses in the entire dataset.
		// The FahrtID is usually proprietary (e.g. `13865-00024-1#HVG`) and therefore doesn't match the GTFS Schedule trip_id.
		// To still be able to match the trip, we guess the operator from various fields, as documented with operatorFromVdvAusIstFahrt().
		const operator = operatorFromVdvAusIstFahrt(istFahrt)

		return {
			id: istFahrt.FahrtID?.FahrtBezeichner || null, // todo: fallback?
			direction: istFahrt.RichtungsText || null,
			line: {
				// todo: some LinienIDs are prefixed with the operator short name, strip it?
				id: istFahrt.LinienID || null,
				name: istFahrt.LinienText || null,
				// todo: mode
				operator: operator ? {
					// We use the GTFS Schedule agency_name for .id here because
					// - @derhuerst/stable-public-transport-ids, called by match-gtfs-rt-to-gtfs, only picks up the .id field (not .name); and
					// - for the GTFS Schedule stable IDs, it just uses `slugg(agency_name)` [0].
					// [0] https://github.com/derhuerst/match-gtfs-rt-to-gtfs/blob/7.0.0-alpha.1/lib/prepare-stable-ids/routes.js#L39-L42
					id: slugg(operator.gtfsAgencyName),
				} : null,
			},
			fahrtNr: istFahrt.UmlaufID || null,

			stopovers: await Promise.all(istFahrt.IstHalts.map(async (istHalt) => {
				const gtfsStop = await queryGtfsStopByAusHaltID(istHalt.HaltID)
				if (gtfsStop === null) {
					logger.warn({
						istHalt,
						istFahrt: omit(istFahrt, ['IstHalts']),
					}, 'failed to match IstHalt.HaltID with GTFS Schedule data')
				}

				const stopId = gtfsStop
					? gtfsStop.stop_id
					: stripDataProviderPrefixFromAusHaltID(istHalt.HaltID) || null
				const stopName = gtfsStop
					? gtfsStop.stop_name
					// todo: what happens if we make it up?
					: 'foo bAr BAZ'
				const stopLocation = {
					type: 'location',
					latitude: gtfsStop ? gtfsStop.stop_lat : 1.23,
					longitude: gtfsStop ? gtfsStop.stop_lon : 2.34,
				}

				return {
					stop: {
						id: stopId,
						name: stopName,
						location: stopLocation,
					},
					plannedArrival: istHalt.Ankunftszeit || null,
					arrival: istHalt.IstAnkunftPrognose || istHalt.Ankunftszeit || null,
					plannedDeparture: istHalt.Abfahrtszeit || null,
					departure: istHalt.IstAbfahrtPrognose || istHalt.Abfahrtszeit || null,
				}
			})),
		}
	}

	return {
		formatVdvAusIstFahrtAsFptfTrip,
		stop,
	}
}

export {
	createFormatVdvAusIstFahrtAsFptfTrip,
}