import {test, after} from 'node:test'
import {ok, deepStrictEqual} from 'node:assert/strict'
import {createLogger} from '../lib/logger.js'
import {createMatchWithGtfs} from '../lib/raw-match.js'

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

	// todo
	// deepStrictEqual(tripUpdate, tripUpdate687)
})
