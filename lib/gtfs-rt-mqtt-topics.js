import _base58 from 'bs58'
import {strictEqual} from 'node:assert/strict'

// We roughly follow HSL's MQTT topic scheme[0][1][2] here, but add the "feed variant" from the "multiple feed variants" proposal [3] to the topic/subject.
// todo: submit proposal/spec for the GTFS-RT spec(s), move this file into a separate lib shared across projects
// [0] https://digitransit.fi/en/developers/apis/4-realtime-api/vehicle-positions/digitransit-mqtt/
// [1] https://github.com/HSLdevcom/gtfsrthttp2mqtt/blob/1d974ff29d9ff2e713b3ebbea081a0a005d780a7/gtfsrthttp2mqtt.py#L118-L123
// [2] https://github.com/HSLdevcom/gtfsrthttp2mqtt/blob/1d974ff29d9ff2e713b3ebbea081a0a005d780a7/gtfsrthttp2mqtt.py#L171C9-L171C54
// [3] https://gist.github.com/derhuerst/f0b6c9cf28b90746770464eb8e5b918f
// see also https://github.com/pailakka/mqttgtfsrtbatcher/blob/c8d4850b0076c4f91c90c18feaa244588697da06/mqttgtfsrtbatcher.go#L99
// see also https://github.com/HSLdevcom/digitransit-ui/blob/43ad1617879be4732c8a6e93e1c123307183153f/app/configurations/realtimeUtils.js
// see also https://github.com/stadtnavi/delay-prediction-service/blob/a574aafb18349fe05043338d03ccdf118172dd78/lib/publish-realtime-data.js#L38

// todo: DRY with OpenDataVBB/nats-consuming-gtfs-rt-server
const SUBJECT_BASE_PREFIX = 'gtfsrt.'

const SUBJECT_VEHICLEPOSITIONS_PREFIX = SUBJECT_BASE_PREFIX + 'vp.'
const SUBJECT_TRIPUPDATES_PREFIX = SUBJECT_BASE_PREFIX + 'tu.'

const _textEncoder = new TextEncoder()
const encodeBase58 = (str) => {
	return _base58.encode(_textEncoder.encode(str))
}
strictEqual(encodeBase58('2025-10-06'), '3pYN3ktvQWAYGV')

// > Special characters: The period . (which is used to separate the tokens in the subject) and * and also > (the * and > are used as wildcards) are reserved and cannot be used.
// > Reserved names: By convention subject names starting with a $ are reserved for system use (e.g. subject names starting with $SYS or $JS or $KV, etc...). Many system subjects also use _ (underscore) (e.g. _INBOX , KV_ABC, OBJ_XYZ etc.)
// https://docs.nats.io/nats-concepts/subjects#characters-allowed-and-recommended-for-subject-names
const escapeSubjectPart = (subjectPart) => {
	return subjectPart
	.replaceAll('.', '__')
	.replaceAll('*', '__')
	.replaceAll('>', '__')
	.replaceAll('$', '__')
	.replaceAll(/\s+/g, '__')
}

// > There is no hard limit to subject size, but it is recommended to keep the maximum number of tokens in your subjects to a reasonable value. E.g. a maximum of 16 tokens and the subject length to less than 256 characters.
// – https://docs.nats.io/nats-concepts/subjects#subject-usage-best-practices
const getNatsSubjectFromGtfsRtTripUpdate = (tripUpdate, scheduleFeedDigest, scheduleFeedVersion) => {
	return [
		SUBJECT_TRIPUPDATES_PREFIX.slice(0, -1), // remove trailing `.`

		// see also https://gist.github.com/derhuerst/f0b6c9cf28b90746770464eb8e5b918f
		// NATS does not allow using empty tokens (i.e. two separators next to each other, e.g. `foo..bar`), so we use `_` as a placeholder. Downstream software like nats-consuming-gtfs-rt-server must handle such placeholders properly.
		scheduleFeedDigest || '_',
		scheduleFeedVersion ? encodeBase58(scheduleFeedVersion) : '_',

		tripUpdate.trip?.trip_id ? escapeSubjectPart(tripUpdate.trip?.trip_id) : '_',
		// todo: implement these:
		// escapeSubjectPart(agency_id, agency_name), // todo
		// escapeSubjectPart(mode), // todo
		// escapeSubjectPart(route_id), // todo
		// escapeSubjectPart(direction_id), // todo
		// escapeSubjectPart(trip_headsign), // todo
		// escapeSubjectPart(trip_id), // todo
		// escapeSubjectPart(next_stop), // todo
		// escapeSubjectPart(start_time), // todo
		// escapeSubjectPart(vehicle_id), // todo: omit?
		// escapeSubjectPart(geohashHead), // todo: omit?
		// escapeSubjectPart(geohashFirstDeg), // todo: omit?
		// escapeSubjectPart(short_name), // todo: what is this?
	].join('.')
}

{
	const feedDigest0 = 'a1b2c3d4'
	const feedVersion0 = 'one TWO.THREE'
	const tU0 = {
		trip: {
			trip_id: 'trip$1 A ',
		},
	}

	strictEqual(
		getNatsSubjectFromGtfsRtTripUpdate(
			{
				trip: null,
			},
			feedDigest0,
			feedVersion0,
		),
		'gtfsrt.tu.a1b2c3d4.AHKRYrRjJuMurT4qu6._',
	)
	strictEqual(
		getNatsSubjectFromGtfsRtTripUpdate(
			{
				trip: {
					trip_id: '',
				},
			},
			feedDigest0,
			feedVersion0,
		),
		'gtfsrt.tu.a1b2c3d4.AHKRYrRjJuMurT4qu6._',
	)
	strictEqual(
		getNatsSubjectFromGtfsRtTripUpdate(tU0, feedDigest0, feedVersion0),
		'gtfsrt.tu.a1b2c3d4.AHKRYrRjJuMurT4qu6.trip__1__A__',
	)
	strictEqual(
		getNatsSubjectFromGtfsRtTripUpdate(tU0, null, feedVersion0),
		'gtfsrt.tu._.AHKRYrRjJuMurT4qu6.trip__1__A__',
	)
	strictEqual(
		getNatsSubjectFromGtfsRtTripUpdate(tU0, '', feedVersion0),
		'gtfsrt.tu._.AHKRYrRjJuMurT4qu6.trip__1__A__',
	)
	strictEqual(
		getNatsSubjectFromGtfsRtTripUpdate(tU0, feedDigest0, null),
		'gtfsrt.tu.a1b2c3d4._.trip__1__A__',
	)
	strictEqual(
		getNatsSubjectFromGtfsRtTripUpdate(tU0, feedDigest0, ''),
		'gtfsrt.tu.a1b2c3d4._.trip__1__A__',
	)
	strictEqual(
		getNatsSubjectFromGtfsRtTripUpdate(
			{
				trip: null,
			},
			null,
			null,
		),
		'gtfsrt.tu._._._',
	)
}

export {
	SUBJECT_BASE_PREFIX,
	SUBJECT_VEHICLEPOSITIONS_PREFIX,
	SUBJECT_TRIPUPDATES_PREFIX,
	getNatsSubjectFromGtfsRtTripUpdate,
}
