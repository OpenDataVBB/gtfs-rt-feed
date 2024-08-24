// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module'
const require = createRequire(import.meta.url)

import {test, after} from 'node:test'
import {deepStrictEqual} from 'node:assert'
import {createLogger} from '../lib/logger.js'
import {createFormatVdvAusIstFahrtAsFptfTrip} from '../lib/vdv-aus-istfahrt-as-fptf-trip.js'

const ausIstFahrt687 = require('./fixtures/aus-istfahrt-13865-00024-1#HVG.json')
const fptfTrip687 = require('./fixtures/fptf-trip-13865-00024-1#HVG.json')
const ausIstFahrt981 = require('./fixtures/aus-istfahrt-17638-00054-1#SVF.json')
const fptfTrip981 = require('./fixtures/fptf-trip-17638-00054-1#SVF.json')

const {
	formatVdvAusIstFahrtAsFptfTrip,
	stop,
} = await createFormatVdvAusIstFahrtAsFptfTrip({
	logger: createLogger('vdv-aus-istfahrt-as-fptf-trip-test', {
		level: 'fatal',
	})
})
after(async () => {
	await stop()
})

test('correctly formats AUS IstFahrt 13865-00024-1#HVG', async (t) => {
	const fptfTrip = await formatVdvAusIstFahrtAsFptfTrip(ausIstFahrt687)
	deepStrictEqual(fptfTrip, fptfTrip687)
})

test('correctly formats AUS IstFahrt 17638-00054-1#SVF', async (t) => {
	const fptfTrip = await formatVdvAusIstFahrtAsFptfTrip(ausIstFahrt981)
	deepStrictEqual(fptfTrip, fptfTrip981)
})
