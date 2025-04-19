// todo: use proper gtfs-rt-bindings

// https://gtfs.org/documentation/realtime/reference/#enum-schedulerelationship_1
// https://gtfs.org/documentation/realtime/proto/
const SCHEDULE_RELATIONSHIP_SCHEDULED = 0
const SCHEDULE_RELATIONSHIP_ADDED = 1
const SCHEDULE_RELATIONSHIP_UNSCHEDULED = 2
const SCHEDULE_RELATIONSHIP_CANCELED = 3

// https://gtfs.org/documentation/realtime/reference/#enum-schedulerelationship
// https://gtfs.org/documentation/realtime/proto/
const STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED = 0
const STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED = 1

export {
	SCHEDULE_RELATIONSHIP_SCHEDULED,
	SCHEDULE_RELATIONSHIP_ADDED,
	SCHEDULE_RELATIONSHIP_UNSCHEDULED,
	SCHEDULE_RELATIONSHIP_CANCELED,
	STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
	STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED,
}
