import {
	createMatchTrip,
	close as closeMatching,
} from 'match-gtfs-rt-to-gtfs'
import {performance} from 'node:perf_hooks'
import rtInfo from './rt-info.js'
import gtfsInfo from './gtfs-info.js'
import {createFormatVdvAusIstFahrtAsFptfTrip} from './vdv-aus-istfahrt-as-fptf-trip.js'

const MATCHED = Symbol.for('match-gtfs-rt-to-gtfs:matched')
const CACHED = Symbol.for('match-gtfs-rt-to-gtfs:cached')

const createMatchWithGtfs = (cfg) => {
	const {
		logger,
	} = cfg

	const {
		formatVdvAusIstFahrtAsFptfTrip,
	} = createFormatVdvAusIstFahrtAsFptfTrip({
		// todo: pass in separate logger for more fine-grained control?
		logger,
	})
	const matchTripWithGtfs = createMatchTrip(rtInfo, gtfsInfo)
	const matchVdvAusIstFahrtWithGtfs = async (vdvAusIstFahrt) => {
		const trip = formatVdvAusIstfahrtAsFptfTrip(vdvAusIstFahrt)
		const matchedTrip = await matchTripWithGtfs(trip)
		return matchedTrip
	}

	const createMatchWithLogging = (kind, getLogCtx, match) => {
		const matchWithLogging = async (origItem) => {
			const logCtx = getLogCtx(origItem)

			const t0 = performance.now()
			// todo: error-log on failures?
			const item = await match(origItem)
			const matchingTime = Math.round((performance.now() - t0) * 100) / 100 // round to 2 digits
			const isMatched = item[MATCHED] === true
			const isCached = item[CACHED] === true

			logger.debug({
				...logCtx,
				isMatched, isCached,
				matchingTime,
			}, [
				isMatched ? 'matched' : 'failed to match',
				isCached ? 'from cache' : 'fresh',
				kind, 'in', matchingTime,
			].join(' '))

			return {
				item,
				isMatched, isCached,
				matchingTime,
			}
		}
		return matchWithLogging
	}

	const matchVdvAusIstFahrtWithLogging = createMatchWithLogging(
		'trip',
		trip => trip.id,
		matchVdvAusIstFahrtWithGtfs,
	)

	return {
		matchVdvAusIstFahrtWithGtfs: matchVdvAusIstFahrtWithLogging,
	}
}

export {
	createMatchWithGtfs,
	closeMatching,
}
