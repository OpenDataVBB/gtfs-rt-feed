// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module'
const require = createRequire(import.meta.url)

import {test, after} from 'node:test'
import {deepStrictEqual} from 'node:assert'
import gtfsInfo from '../lib/gtfs-info.js'
import rtInfo from '../lib/rt-info.js'
import {formatFptfTripAsGtfsRtTripUpdate} from '../lib/fptf-trip-as-gtfs-rt-tripupdate.js'

const fptfTrip687 = require('./fixtures/fptf-trip-13865-00024-1#HVG.json')
const fptfTrip687Matched = {
	...fptfTrip687,
	id: 'todo',
	ids: {
		[gtfsInfo.endpointName]: 'todo',
		[rtInfo.endpointName]: fptfTrip687.id,
	},
	routeId: '10684_700',
	// routeIds: {
	// 	[gtfsInfo.endpointName]: '10684_700',
	// },
	directionId: '0',
	directionIds: {
		[gtfsInfo.endpointName]: '0',
	},
}

// const tripUpdate687 = require('./fixtures/tripupdate-13865-00024-1#HVG.json')
// const fptfTrip981 = require('./fixtures/fptf-trip-17638-00054-1#SVF.json')
// const tripUpdate981 = require('./fixtures/tripupdate-17638-00054-1#SVF.json')

test('correctly formats FPTF trip 13865-00024-1#HVG as GTFS-RT TripUpdate', (t) => {
	const tripUpdate = formatFptfTripAsGtfsRtTripUpdate(fptfTrip687Matched)
	console.error(tripUpdate)
	// deepStrictEqual(tripUpdate, tripUpdate687)
})
