// As of version 7, match-gtfs-rt-to-gtfs expects a trip in the FPTF format, which is not precisely defined, so we use the draft FPTF v2 spec [1] and hafas-client's format [2] as a reference.
// [1] https://github.com/public-transport/friendly-public-transport-format/tree/3bd36faa721e85d9f5ca58fb0f38cdbedb87bbca/spec
// [2] https://github.com/public-transport/hafas-client/blob/65096a85b69628c5fef03f35bd2ac816e8ce7f89/docs/trip.md
// todo: make match-gtfs-rt-to-gtfs accept GTFS-style or GTFS-RT-formatted trips instead
const formatVdvAusIstfahrtAsFptfTrip = (istFahrt) => {
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
			return {
				stop: {
					// todo: remove prefix from HaltID?
					id: istHalt.HaltID || null,
					// todo: name
					// todo: location
				},
				plannedArrival: istHalt.Ankunftszeit || null,
				arrival: istHalt.IstAnkunftPrognose || istHalt.Ankunftszeit || null,
				plannedDeparture: istHalt.Abfahrtszeit || null,
				departure: istHalt.IstAbfahrtPrognose || istHalt.Abfahrtszeit || null,
			}
		}),
	}
}

export {
	formatVdvAusIstfahrtAsFptfTrip,
}