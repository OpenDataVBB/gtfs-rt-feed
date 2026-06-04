import {test, after} from 'node:test'
import {ok, deepStrictEqual} from 'node:assert/strict'
import {createLogger} from '../lib/logger.js'
import {createMatchWithGtfs} from '../lib/raw-match.js'

import ausIstFahrt687 from './fixtures/aus-istfahrt-13865-00024-1%23HVG.json' with {type: 'json'}
import tripUpdate687 from './fixtures/tripupdate-13865-00024-1_HVG.js'
import ausIstFahrt981 from './fixtures/aus-istfahrt-17638-00054-1%23SVF.json' with {type: 'json'}
import tripUpdate981 from'./fixtures/tripupdate-17638-00054-1_SVF.js'
import ausIstFahrtU8 from './fixtures/aus-istfahrt-270624_1327HMSWIU%23BVG.json' with {type: 'json'}
import tripUpdateU8 from './fixtures/tripupdate-270624_1327HMSWIU_BVG.js'

const {
	matchVdvAusIstFahrtWithGtfs,
	stop,
} = await createMatchWithGtfs({
	logger: createLogger('matching-test', {
		// todo: revert
		level: 'trace',
		// level: 'fatal',
	})
})
after(async () => {
	await stop()
})

// todo: add tests for pickStopTimeUpdatesForMatching()?

test('correctly matches AUS IstFahrt 13865-00024-1#HVG & converts to TripUpdate', async (t) => {
	const {
		item: tripUpdate,
		isMatched,
		isCached,
	} = await matchVdvAusIstFahrtWithGtfs(ausIstFahrt687)
	ok(!isCached, 'must not be cached')
	ok(isMatched, 'must be matched')

	// todo: expect platform names
	deepStrictEqual(tripUpdate, tripUpdate687)
})

test('correctly matches AUS IstFahrt 17638-00054-1#SVF & converts to TripUpdate', async (t) => {
	const {
		item: tripUpdate,
		isMatched,
		isCached,
	} = await matchVdvAusIstFahrtWithGtfs(ausIstFahrt981)
	ok(!isCached, 'must not be cached')
	ok(isMatched, 'must be matched')

	// todo: match `ODEG_122207` IstHalt too – see notes in `tripUpdate981` fixture
	// todo: expect platform names
	deepStrictEqual(tripUpdate, tripUpdate981)
})

test('correctly matches the sparse AUS IstFahrt 270624_1327HMSWIU#BVG & converts to TripUpdate', async (t) => {
	const {
		item: tripUpdate,
		isMatched,
		isCached,
	} = await matchVdvAusIstFahrtWithGtfs(ausIstFahrtU8)
	ok(!isCached, 'must not be cached')
	ok(isMatched, 'must be matched')

	// todo: expect platform names
	// console.error(inspect(tripUpdate, {depth: null, colors: true}))
	// console.error(JSON.stringify(tripUpdate))
	deepStrictEqual(tripUpdate, tripUpdateU8)
})

// todo: more cases
// todo: correctly fails with ambiguous match
