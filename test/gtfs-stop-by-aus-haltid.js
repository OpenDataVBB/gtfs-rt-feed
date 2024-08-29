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

test('does not allow `%` SQL injections', async (t) => {
	// There is only one stop with a stop_id matching `%:90044994%`, so if we insert `90044994%` unescaped into a `LIKE '%' || $1` query, we obtain a non-ambiguous result through injection.
	const stop = await queryGtfsStopByAusHaltID('90044994%')
	deepStrictEqual(stop, null, 'must not return a stop')
})
