import {createMetricsServer} from './lib/metrics.js'
import {createLogger} from './lib/logger.js'
import {runGtfsMatching} from './lib/gtfs-matching.js'
import {withSoftExit} from './lib/soft-exit.js'

const logger = createLogger('service')

const abortWithError = (err) => {
	logger.error(err)
	process.exit(1)
}

const metricsServer = createMetricsServer()
metricsServer.start()
.then(() => {
	logger.info(`serving Prometheus metrics on port ${metricsServer.address().port}`)
}, abortWithError)

// todo: expose health check!
// - check if DB looks good

try {
	const {
		stop: stopGtfsMatching,
	} = await runGtfsMatching({
		logger,
	})

	withSoftExit(() => {
		stopGtfsMatching().catch(abortWithError)
		metricsServer.close()
	})
} catch (err) {
	logger.error(err)
	process.exit(1)
}
