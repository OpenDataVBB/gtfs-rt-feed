import {test, after} from 'node:test'
import {ok, deepStrictEqual} from 'node:assert/strict'
import pick from 'lodash/pick.js'
import {createLogger} from '../lib/logger.js'
import {createMatchWithGtfs} from '../lib/raw-match.js'
import {
	extractDataSourceFromFahrtBezeichner as defaultExtractDataSourceFromFahrtBezeichner,
} from '../lib/extract-data-srv-from-vdv-fahrtbezeichner.js'

import ausIstFahrtKomplettfahrt from './fixtures/aus-istfahrt-2026-07-06-M19-129776-860514850000-komplettfahrt.json' with {type: 'json'}

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

// At 2026-07-06T14:23:00+02:00, the AUS IstFahrt departs at `900058103`, while the Schedule database uses `de:11000:900058108::1` (both S+U Yorckstr.).
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
			schedule_relationship: 0,
			stop_id: 'de:11000:900048101::1',
			stop_sequence: 0,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900048158::1',
			stop_sequence: 1,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900048155::1',
			stop_sequence: 2,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900048110::1',
			stop_sequence: 3,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900048156::1',
			stop_sequence: 4,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900048103::3',
			stop_sequence: 5,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900040101::3',
			stop_sequence: 6,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900040104::1',
			stop_sequence: 7,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900040151::1',
			stop_sequence: 8,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900023302::4',
			stop_sequence: 9,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900023304::2',
			stop_sequence: 10,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900023351::2',
			stop_sequence: 11,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900023301::3',
			stop_sequence: 12,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900023203::6',
			stop_sequence: 13,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900023204::1',
			stop_sequence: 14,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900056101::7',
			stop_sequence: 15,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900056105::1',
			stop_sequence: 16,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900056102::8',
			stop_sequence: 17,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900056104::4',
			stop_sequence: 18,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900057107::2',
			stop_sequence: 19,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900057171::1',
			stop_sequence: 20,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900057102::1',
			stop_sequence: 21,
		},

		// cancelled GTFS Schedule stop_time
		{
			schedule_relationship: 1,
			stop_id: 'de:11000:900058108::1',
			stop_sequence: 22,
		},
		// additional VDV Halt
		{
			schedule_relationship: null,
			stop_id: '900058103'
		},

		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900057155::1',
			stop_sequence: 23,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900017105::2',
			stop_sequence: 24,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900017101::5',
			stop_sequence: 25,
		},
		{
			schedule_relationship: 0,
			stop_id: 'de:11000:900017171::2',
			stop_sequence: 26,
		},
	])
})
