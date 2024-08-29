import {test, after} from 'node:test'
import {deepStrictEqual} from 'node:assert'
import {createLogger} from '../lib/logger.js'
import {createQueryGtfsStopByAusHaltID} from '../lib/gtfs-stop-by-aus-haltid.js'

const {
	uncachedQueryGtfsStopByAusHaltID: queryGtfsStopByAusHaltID,
	stop,
} = await createQueryGtfsStopByAusHaltID({
	logger: createLogger('gtfs-stop-by-aus-haltid-test', {
		level: 'fatal',
	})
})
after(async () => {
	await stop()
})

test('works with a corresponding Schedule station', async (t) => {
	// from ./fixtures/aus-istfahrt-13865-00024-1#HVG.json
	const stop = await queryGtfsStopByAusHaltID('ODEG_900210771')
	deepStrictEqual(stop, {
		stop_id: 'de:12063:900210771',
		stop_name: 'Rathenow, Bahnhof',
		stop_lat: 52.600105,
		stop_lon: 12.354617,
	})
})

test('works with corresponding Schedule stops only, without parent station', async (t) => {
	// from ./fixtures/aus-istfahrt-13865-00024-1#HVG.json
	const stop = await queryGtfsStopByAusHaltID('ODEG_900360079')
	deepStrictEqual(stop, {
		stop_id: 'de:12053:900360079::1',
		stop_name: 'Frankfurt (Oder), Kopernikusstr.',
		stop_lat: 52.327039,
		stop_lon: 14.511701,
	})
})

test('does not allow `%` SQL injections', async (t) => {
	// There is only one stop with a stop_id matching `%:90044994%`, so if we insert `90044994%` unescaped into a `LIKE '%' || $1` query, we obtain a non-ambiguous result through injection.
	const stop = await queryGtfsStopByAusHaltID('90044994%')
	deepStrictEqual(stop, null, 'must not return a stop')
})
