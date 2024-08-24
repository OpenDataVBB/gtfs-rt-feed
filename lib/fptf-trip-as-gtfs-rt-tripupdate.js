import gtfsInfo from './gtfs-info.js'

const iso8601ToPosixTime = (iso8601) => {
	return Math.round(Date.parse(iso8601) / 1000)
}

const formatFptfWhenAsGtfsRtStopTimeEvent = (field, plannedField, stopover) => {
	const when = stopover[field]
	const plannedWhen = stopover[plannedField]
	if (!when) {
		return null
	}

	return {
		// > - delay should be used when the prediction is given relative to some existing schedule in GTFS.
		// > - time should be given whether there is a predicted schedule or not. If both time and delay are specified, time will take precedence (although normally, time, if given for a scheduled trip, should be equal to scheduled time in GTFS + delay).
		// https://gtfs.org/realtime/reference/#message-stoptimeevent
		time: iso8601ToPosixTime(when),
		delay: plannedWhen ? iso8601ToPosixTime(when) - iso8601ToPosixTime(plannedWhen) : null
	}
}
const formatFptfArrivalAsGtfsRtStopTimeEvent = formatFptfWhenAsGtfsRtStopTimeEvent.bind(
	null,
	'arrival',
	'plannedArrival',
)
const formatFptfDepartureAsGtfsRtStopTimeEvent = formatFptfWhenAsGtfsRtStopTimeEvent.bind(
	null,
	'departure',
	'plannedDeparture',
)

// As of version 7, match-gtfs-rt-to-gtfs returns a trip in the FPTF format, which is not precisely defined, so we use the draft FPTF v2 spec [1] and hafas-client's format [2] as a reference.
// [1] https://github.com/public-transport/friendly-public-transport-format/tree/3bd36faa721e85d9f5ca58fb0f38cdbedb87bbca/spec
// [2] https://github.com/public-transport/hafas-client/blob/65096a85b69628c5fef03f35bd2ac816e8ce7f89/docs/trip.md
// todo: make match-gtfs-rt-to-gtfs return GTFS-style or GTFS-RT-formatted trips instead
const formatFptfTripAsGtfsRtTripUpdate = (trip) => {
	return {
		// todo: timestamp?
		trip: {
			// todo: or use .endpointName?
			trip_id: trip.ids?.[gtfsInfo.idNamespace] ?? trip.id,
			// find-hafas-data-in-another-hafas@4.4.0's mergeLeg(), called by match-gtfs-rt-to-gtfs@7, doesn't add .routeIds, so we just use .routeId.
			// todo: fix this
			route_id: trip.routeId ?? null,
			// todo: or use .endpointName?
			direction_id: trip.directionIds?.[gtfsInfo.idNamespace] ?? trip.directionId ?? null,
			// todo: start_date, start_time – e.g. from .plannedDeparture?
			// todo: schedule_relationship from .cancelled?
			// > Frequency-based trips (GTFS frequencies.txt with exact_times = 0) should not have a SCHEDULED value and should use UNSCHEDULED instead.
			// https://gtfs.org/realtime/reference/#enum-schedulerelationship
		},
		vehicle: {
			// todo: id?
			// todo: label?
			// todo: license_plate?
			// todo: wheelchair_accessible
		},
		// todo: delay based on upcoming stopover?
		stop_time_update: trip.stopovers.map((st) => {
			return {
				// todo: stop_sequence

				// todo: schedule_relationship from .cancelled?
				// > Frequency-based trips (GTFS frequencies.txt with exact_times = 0) should not have a SCHEDULED value and should use UNSCHEDULED instead.
				// https://gtfs.org/realtime/reference/#enum-schedulerelationship

				// todo: or use .endpointName?
				stop_id: st.stop.ids?.[gtfsInfo.idNamespace] ?? st.stop.id,
				arrival: formatFptfArrivalAsGtfsRtStopTimeEvent(st),
				departure: formatFptfDepartureAsGtfsRtStopTimeEvent(st),
				// todo: departure_occupancy_status?
			}
		}),
	}
}

export {
	formatFptfTripAsGtfsRtTripUpdate,
}