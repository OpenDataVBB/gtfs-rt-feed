import {test, after} from 'node:test'
import {ok, deepStrictEqual} from 'node:assert/strict'
import pick from 'lodash/pick.js'
import {createLogger} from '../lib/logger.js'
import {createMatchWithGtfs} from '../lib/raw-match.js'
import {
	extractDataSourceFromFahrtBezeichner as defaultExtractDataSourceFromFahrtBezeichner,
} from '../lib/extract-data-srv-from-vdv-fahrtbezeichner.js'
import {
	STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
	STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_NO_DATA,
} from '../lib/gtfs-rt.js'

import ausIstFahrt from './fixtures/aus-istfahrt-2026-07-30-M29-96013-860414150100.json' with {type: 'json'}

const {
	matchVdvAusIstFahrtWithGtfs,
	stop,
} = await createMatchWithGtfs({
	logger: createLogger('matching-test', {
		level: 'fatal',
	}),
	extractDataSourceFromFahrtBezeichner: defaultExtractDataSourceFromFahrtBezeichner,
})
after(async () => {
	await stop()
})

// last 2 AUS IstHalts:
// ┌────────────────────┬──────────┬────────────┬─────────────────────┬───────────┬────────────────────────┬────────────────────────┬────────────────────────┬────────────────────────┬────────────┬──────────────────────────────────┐
// │  FahrtBezeichner   │ LinienID │ LinienText │    RichtungsText    │  HaltID   │ Abfahrtszeit           │ IstAbfahrtPrognose     │      Ankunftszeit      │   IstAnkunftPrognose   │ Zusatzhalt │             stop_name            │
// ├────────────────────┼──────────┼────────────┼─────────────────────┼───────────┼────────────────────────┼────────────────────────┼────────────────────────┼────────────────────────┼────────────┼──────────────────────────────────┤
// │ 96013─860414150100 │ M29      │ M29        │ Grunewald, Roseneck │ 900046354 │ 2026─07─31 01:44:00+02 │ 2026─07─31 01:45:00+02 │ 2026─07─31 01:44:00+02 │ 2026─07─31 01:45:00+02 │ NULL       │ Roseneck/Teplitzer Str. (Berlin) │
// │ 96013─860414150100 │ M29      │ M29        │ Grunewald, Roseneck │ 900048109 │ NULL                   │ NULL                   │ 2026─07─31 01:45:00+02 │ 2026─07─31 01:46:00+02 │ NULL       │ Roseneck (Berlin)                │
// └────────────────────┴──────────┴────────────┴─────────────────────┴───────────┴────────────────────────┴────────────────────────┴────────────────────────┴────────────────────────┴────────────┴──────────────────────────────────┘
// last 3 GTFS stop_times:
// ┌────────────┬───────────────────────┬──────────────────────────────────┬────────────┬──────────────┬────────────────────────┬────────────────────────┐
// │ stop_seq_c │        stop_id        │                stop_name         │ station_id │ station_name │       t_arrival        │      t_departure       │
// ├────────────┼───────────────────────┼──────────────────────────────────┼────────────┼──────────────┼────────────────────────┼────────────────────────┤
// │         43 │ de:11000:900046354::4 │ Roseneck/Teplitzer Str. (Berlin) │ NULL       │ NULL         │ 2026-07-31 01:44:00+02 │ 2026-07-31 01:44:00+02 │
// │         44 │ de:11000:900048109::3 │ Roseneck (Berlin)                │ NULL       │ NULL         │ 2026-07-31 01:45:00+02 │ 2026-07-31 01:45:00+02 │
// │         45 │ de:11000:900048109::1 │ Roseneck (Berlin)                │ NULL       │ NULL         │ 2026-07-31 01:45:00+02 │ 2026-07-31 01:45:00+02 │
// └────────────┴───────────────────────┴──────────────────────────────────┴────────────┴──────────────┴────────────────────────┴────────────────────────┘
test('correctly matches AUS IstFahrt', async (t) => {
	const {
		item: tripUpdate,
		isMatched,
		isCached,
	} = await matchVdvAusIstFahrtWithGtfs(ausIstFahrt)
	ok(!isCached, 'must not be cached')
	ok(isMatched, 'must be matched')

	const actualSTUs = tripUpdate.stop_time_update
	.map((stu) => {
		return pick(stu, ['stop_sequence', 'stop_id', 'schedule_relationship'])
	})

	deepStrictEqual(actualSTUs.slice(-3), [
		{
			stop_sequence: 43,
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
			stop_id: 'de:11000:900046354::4',
		},
		{
			stop_sequence: 44,
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
			stop_id: 'de:11000:900048109::3',
		},
		{
			stop_sequence: 45,
			// Note: We expect the service stop from the GTFS Schedule data *not to be* marked as cancelled.
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_NO_DATA,
			stop_id: 'de:11000:900048109::1',
		},
	])
})
