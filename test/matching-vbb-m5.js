import {test, after} from 'node:test'
import {ok, deepStrictEqual} from 'node:assert/strict'
import pick from 'lodash/pick.js'
import {createLogger} from '../lib/logger.js'
import {createMatchWithGtfs} from '../lib/raw-match.js'
import {
	STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
	STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED,
} from '../lib/gtfs-rt.js'

import ausIstFahrtKomplettfahrt from './fixtures/aus-istfahrt-2026-06-04-M5-26342-860574653700-komplettfahrt.json' with {type: 'json'}

const {
	matchVdvAusIstFahrtWithGtfs,
	stop,
} = await createMatchWithGtfs({
	logger: createLogger('matching-test', {
		level: 'fatal',
	})
})
after(async () => {
	await stop()
})

test('correctly matches AUS IstFahrt with Komplettfahrt=true & converts to TripUpdate', async (t) => {
	const {
		item: tripUpdate,
		isMatched,
		isCached,
	} = await matchVdvAusIstFahrtWithGtfs(ausIstFahrtKomplettfahrt)
	ok(!isCached, 'must not be cached')
	ok(isMatched, 'must be matched')

	const actualSTUs = tripUpdate.stop_time_update
	.map((stu) => {
		return pick(stu, ['stop_sequence', 'stop_id', 'schedule_relationship'])
	})

	deepStrictEqual(actualSTUs, [
		{
			stop_sequence: 0,
			stop_id: 'de:11000:900003255::3',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 1,
			stop_id: 'de:11000:900003201::3',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 2,
			stop_id: 'de:11000:900100503::2',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 3,
			stop_id: 'de:11000:900100710::1',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 4,
			stop_id: 'de:11000:900100506::1',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 5,
			stop_id: 'de:11000:900100007::2',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 6,
			stop_id: 'de:11000:900100512::3',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 7,
			stop_id: 'de:11000:900100002::2',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 8,
			stop_id: 'de:11000:900100515::2',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 9,
			stop_id: 'de:11000:900100026::2',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 10,
			stop_id: 'de:11000:900100005::2',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 11,
			stop_id: 'de:11000:900100040::8',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 12,
			stop_id: 'de:11000:900120511::4',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 13,
			stop_id: 'de:11000:900120019::6',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},                                                                                                                             {
			stop_sequence: 14,
			stop_id: 'de:11000:900120513::4',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 15,
			stop_id: 'de:11000:900120016::4',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 16,
			stop_id: 'de:11000:900110004::2',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 17,
			stop_id: 'de:11000:900110030::1',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 18,
			stop_id: 'de:11000:900160508::1',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 19,
			stop_id: 'de:11000:900150011::4',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 20,
			stop_id: 'de:11000:900150510::3',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 21,
			stop_id: 'de:11000:900150511::1',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 22,
			stop_id: 'de:11000:900150512::1',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 23,
			stop_id: 'de:11000:900150513::1',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 24,
			stop_id: 'de:11000:900150007::5',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 25,
			stop_id: 'de:11000:900150020::5',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		{
			stop_sequence: 26,
			stop_id: 'de:11000:900150504::11',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SCHEDULED,
		},
		// SKIPPED from here because
		// - the Schedule trip instance contains them, but
		// - the Komplettfahrt=true AUS IstFahrt doesn't contain them.
		{
			stop_sequence: 27,
			stop_id: 'de:11000:900150500::4',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED,
		},
		{
			stop_sequence: 28,
			stop_id: 'de:11000:900152509::4',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED,
		},
		{
			stop_sequence: 29,
			stop_id: 'de:11000:900152508::6',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED,
		},
		{
			stop_sequence: 30,
			stop_id: 'de:11000:900151006::3',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED,
		},
		{
			stop_sequence: 31,
			stop_id: 'de:11000:900152001::1',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED,
		},
		{
			stop_sequence: 32,
			stop_id: 'de:11000:900152006::1',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED,
		},
		{
			stop_sequence: 33,
			stop_id: 'de:11000:900152003::5',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED,
		},
		{
			stop_sequence: 34,
			stop_id: 'de:11000:900152007::6',
			schedule_relationship: STOPTIMEUPDATE_SCHEDULE_RELATIONSHIP_SKIPPED,
		},
	])
})
