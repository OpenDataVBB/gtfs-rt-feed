// We roughly follow HSL's MQTT topic scheme[0][1][2] here.
// todo: strictly follow the HSL scheme, or consider following the SSB scheme
// [0] https://digitransit.fi/en/developers/apis/4-realtime-api/vehicle-positions/digitransit-mqtt/
// [1] https://github.com/HSLdevcom/gtfsrthttp2mqtt/blob/1d974ff29d9ff2e713b3ebbea081a0a005d780a7/gtfsrthttp2mqtt.py#L118-L123
// [2] https://github.com/HSLdevcom/gtfsrthttp2mqtt/blob/1d974ff29d9ff2e713b3ebbea081a0a005d780a7/gtfsrthttp2mqtt.py#L171C9-L171C54
// Note: There should be a proposal/spec delineating an "official" scheme for GTFS-RT.
// see also https://github.com/pailakka/mqttgtfsrtbatcher/blob/c8d4850b0076c4f91c90c18feaa244588697da06/mqttgtfsrtbatcher.go#L99
// see also https://github.com/HSLdevcom/digitransit-ui/blob/43ad1617879be4732c8a6e93e1c123307183153f/app/configurations/realtimeUtils.js
// see also https://github.com/stadtnavi/delay-prediction-service/blob/a574aafb18349fe05043338d03ccdf118172dd78/lib/publish-realtime-data.js#L38

const TOPIC_BASE_PREFIX = 'gtfsrt.'

const TOPIC_VEHICLEPOSITIONS_PREFIX = TOPIC_BASE_PREFIX + 'vp.'
const TOPIC_TRIPUPDATES_PREFIX = TOPIC_BASE_PREFIX + 'tu.'

// > Special characters: The period . (which is used to separate the tokens in the subject) and * and also > (the * and > are used as wildcards) are reserved and cannot be used.
// > Reserved names: By convention subject names starting with a $ are reserved for system use (e.g. subject names starting with $SYS or $JS or $KV, etc...). Many system subjects also use _ (underscore) (e.g. _INBOX , KV_ABC, OBJ_XYZ etc.)
// https://docs.nats.io/nats-concepts/subjects#characters-allowed-and-recommended-for-subject-names
const escapeTopicPart = (topicPart) => {
	return topicPart
	.replaceAll('.', '__')
	.replaceAll('*', '__')
	.replaceAll('>', '__')
	.replaceAll('$', '__')
}

const getNatsTopicFromGtfsRtTripUpdate = (tripUpdate) => {
	return [
		TOPIC_TRIPUPDATES_PREFIX.slice(0, -1), // remove trailing `.`
		tripUpdate.trip?.trip_id ? escapeTopicPart(tripUpdate.trip?.trip_id) : null,
		// todo: implement these:
		// escapeTopicPart(FEED_NAME), // todo
		// escapeTopicPart(agency_id, agency_name), // todo
		// escapeTopicPart(mode), // todo
		// escapeTopicPart(route_id), // todo
		// escapeTopicPart(direction_id), // todo
		// escapeTopicPart(trip_headsign), // todo
		// escapeTopicPart(trip_id), // todo
		// escapeTopicPart(next_stop), // todo
		// escapeTopicPart(start_time), // todo
		// escapeTopicPart(vehicle_id), // todo: omit?
		// escapeTopicPart(geohashHead), // todo: omit?
		// escapeTopicPart(geohashFirstDeg), // todo: omit?
		// escapeTopicPart(short_name), // todo: what is this?
	].join('.')
}

export {
	TOPIC_BASE_PREFIX,
	TOPIC_VEHICLEPOSITIONS_PREFIX,
	TOPIC_TRIPUPDATES_PREFIX,
	getNatsTopicFromGtfsRtTripUpdate,
}
