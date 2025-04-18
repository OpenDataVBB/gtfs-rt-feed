// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module'
const require = createRequire(import.meta.url)

import {test, after} from 'node:test'
import {ok, deepStrictEqual} from 'node:assert/strict'
import {createLogger} from '../lib/logger.js'
import {createMatchWithGtfs} from '../lib/raw-match.js'

const ausIstFahrt687 = require('./fixtures/aus-istfahrt-13865-00024-1#HVG.json')
import tripUpdate687 from './fixtures/tripupdate-13865-00024-1_HVG.js'
const ausIstFahrt981 = require('./fixtures/aus-istfahrt-17638-00054-1#SVF.json')
import tripUpdate981 from'./fixtures/tripupdate-17638-00054-1_SVF.js'
const ausIstFahrtU8 = require('./fixtures/aus-istfahrt-270624_1327HMSWIU#BVG.json')
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
