import {performance} from 'node:perf_hooks'
import {createLogger} from './logger.js'
import {
	createFormatVdvAusIstFahrtAsGtfsRtTripUpdate,
} from './vdv-aus-istfahrt-as-gtfs-rt-tripupdate.js'
import {
	createMatchGtfsRtTripUpdateWithScheduleStopTimes,
} from './match-with-schedule-trip.js'

const formattingLogger = createLogger('formatting', {
	level: (process.env.LOG_LEVEL_FORMATTING || 'WARN').toLowerCase(),
})

const createMatchWithGtfs = async (cfg) => {
	const {
		logger,
	} = cfg

	const {
		formatVdvAusIstFahrtAsGtfsRtTripUpdate,
	} = await createFormatVdvAusIstFahrtAsGtfsRtTripUpdate({
		// todo: pass in separate logger for more fine-grained control?
		logger: formattingLogger,
	})
	const {
		matchGtfsRtTripUpdateWithScheduleStopTimes,
		stop: stopMatching,
	} = await createMatchGtfsRtTripUpdateWithScheduleStopTimes({
		logger,
	})
	const matchVdvAusIstFahrtWithGtfs = async (vdvAusIstFahrt) => {
		const unmatchedTripUpdate = formatVdvAusIstFahrtAsGtfsRtTripUpdate(vdvAusIstFahrt)
		const {
			tripUpdate,
			isMatched,
			isCached,
		} = await matchGtfsRtTripUpdateWithScheduleStopTimes(unmatchedTripUpdate)
		// todo: trace-log unmatched & matched tripUpdate?
		return {
			item: tripUpdate,
			isMatched,
			isCached,
		}
	}

	const createMatchWithLogging = (kind, getLogCtx, match) => {
		const matchWithLogging = async (origItem) => {
			const logCtx = getLogCtx(origItem)

			const t0 = performance.now()
			// todo: error-log on failures?
			const {
				isMatched,
				isCached,
				item,
			} = await match(origItem)
			const matchingTime = Math.round((performance.now() - t0) * 100) / 100 // round to 2 digits

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

	const stop = async () => {
		await stopMatching()
	}

	return {
		matchVdvAusIstFahrtWithGtfs: matchVdvAusIstFahrtWithLogging,
		stop,
	}
}

export {
	createMatchWithGtfs,
}
