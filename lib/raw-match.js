import {
	createMatchTrip,
	close as closeMatching,
} from 'match-gtfs-rt-to-gtfs'
import {performance} from 'node:perf_hooks'
import {createLogger} from './logger.js'
import rtInfo from './rt-info.js'
import gtfsInfo from './gtfs-info.js'
import {createFormatVdvAusIstFahrtAsFptfTrip} from './vdv-aus-istfahrt-as-fptf-trip.js'
import {formatFptfTripAsGtfsRtTripUpdate} from './fptf-trip-as-gtfs-rt-tripupdate.js'

const MATCHED = Symbol.for('match-gtfs-rt-to-gtfs:matched')
const CACHED = Symbol.for('match-gtfs-rt-to-gtfs:cached')

const formattingLogger = createLogger('formatting', {
	level: (process.env.LOG_LEVEL_FORMATTING || 'WARN').toLowerCase(),
})

const createMatchWithGtfs = async (cfg) => {
	const {
		logger,
	} = cfg

	const {
		formatVdvAusIstFahrtAsFptfTrip,
		stop,
	} = await createFormatVdvAusIstFahrtAsFptfTrip({
		// todo: pass in separate logger for more fine-grained control?
		logger: formattingLogger,
	})
	const matchTripWithGtfs = createMatchTrip(rtInfo, gtfsInfo)
	const matchVdvAusIstFahrtWithGtfs = async (vdvAusIstFahrt) => {
		const trip = await formatVdvAusIstFahrtAsFptfTrip(vdvAusIstFahrt)
		const matchedTrip = await matchTripWithGtfs(trip)

		const tripUpdate = formatFptfTripAsGtfsRtTripUpdate(matchedTrip)
		// todo: trace-log trip, matchedTrip & tripUpdate?
		return tripUpdate
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
		stop,
	}
}

export {
	createMatchWithGtfs,
	closeMatching,
}
