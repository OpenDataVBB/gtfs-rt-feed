import {
	stripDataProviderPrefixFromAusHaltID,
} from './gtfs-stop-by-aus-haltid.js'

// As of version 7, match-gtfs-rt-to-gtfs expects a trip in the FPTF format, which is not precisely defined, so we use the draft FPTF v2 spec [1] and hafas-client's format [2] as a reference.
// [1] https://github.com/public-transport/friendly-public-transport-format/tree/3bd36faa721e85d9f5ca58fb0f38cdbedb87bbca/spec
// [2] https://github.com/public-transport/hafas-client/blob/65096a85b69628c5fef03f35bd2ac816e8ce7f89/docs/trip.md
// todo: make match-gtfs-rt-to-gtfs accept GTFS-style or GTFS-RT-formatted trips instead
const createFormatVdvAusIstFahrtAsFptfTrip = (cfg) => {
	const {
		logger,
	} = cfg

	const formatVdvAusIstFahrtAsFptfTrip = async (istFahrt) => {
		return {
			id: istFahrt.FahrtID?.FahrtBezeichner || null, // todo: fallback?
			direction: istFahrt.RichtungsText || null,
			line: {
				id: istFahrt.LinienID || null,
				name: istFahrt.LinienText || null,
				// todo: mode
			},
			fahrtNr: istFahrt.UmlaufID || null,

			stopovers: istFahrt.IstHalts.map((istHalt) => {
				// todo: try to look it up from GTFS Schedule data
				const stopId = stripDataProviderPrefixFromAusHaltID(istHalt.HaltID) || null
				// todo: what happens if we make it up?
				const stopName = 'foo bAr BAZ'
				// todo: try to look it up from GTFS Schedule data
				// todo: what happens if we make it up?
				const stopLocation = {
					type: 'location',
					latitude: 1.23,
					longitude: 2.34,
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
			}),
		}
	}

	return {
		formatVdvAusIstFahrtAsFptfTrip,
	}
}

export {
	createFormatVdvAusIstFahrtAsFptfTrip,
}