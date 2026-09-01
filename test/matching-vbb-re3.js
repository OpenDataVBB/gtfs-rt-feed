import {test, after} from 'node:test'
import {ok, deepStrictEqual} from 'node:assert/strict'
import pick from 'lodash/pick.js'
import {createLogger} from '../lib/logger.js'
import {createMatchWithGtfs} from '../lib/raw-match.js'

import ausIstFahrtKomplettfahrt from './fixtures/aus-istfahrt-2026-09-01-3357-800158-8012943-200400_DB_DB-komplettfahrt.json' with {type: 'json'}

const {
	matchVdvAusIstFahrtWithGtfs,
	stop,
} = await createMatchWithGtfs({
	logger: createLogger('matching-test', {
		level: 'fatal',
	}),
})
after(async () => {
	await stop()
})

// At 2026-09-01T20:26:00+02:00, the AUS IstFahrt arrivals at `900340004`, while the Schedule database uses `000300570037` with a `parent_station` of `de:12073:900340004`.
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
			stop_id: 'de:12073:900341110:1:50',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 1,
			stop_id: 'de:12073:900341111:1:50',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 2,
			stop_id: 'de:12073:900340003:1:50',
			schedule_relationship: 0,
		},

		// cancelled GTFS Schedule stop_time
		{
			stop_sequence: 3,
			stop_id: '000300570037',
			schedule_relationship: 1
		},
		// additional VDV Halt
		{
			stop_id: '900340004',
			schedule_relationship: null,
		},

		{
			stop_sequence: 4,
			stop_id: 'de:12060:900350125:2:51',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 5,
			stop_id: 'de:12060:900350124:2:51',
			schedule_relationship: 0                                                                                                                         },
		{
			stop_sequence: 6,
			stop_id: 'de:12060:900350127:3:53',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 7,
			stop_id: 'de:12060:900350160:2:52',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 8,
			stop_id: 'de:11000:900007102:4:57',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 9,
			stop_id: 'de:11000:900003200:1:50',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 10,
			stop_id: 'de:11000:900100020:1:50',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 11,
			stop_id: 'de:11000:900058101:2:53',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 12,
			stop_id: 'de:11000:900064301:1:50',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 13,
			stop_id: 'de:12069:900220001:1:50',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 14,
			stop_id: 'de:12072:900245032:1:50',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 15,
			stop_id: 'de:12072:900245030:1:50',
			schedule_relationship: 0,
		},
		{
			stop_sequence: 16,
			stop_id: 'de:12072:900245029:1:51',
			schedule_relationship: 0,
		},
	])
})
