import {Counter} from 'prom-client'
import {createMetricsServer, register} from './lib/metrics.js'
import {createLogger} from './lib/logger.js'
import {connectToNats} from './lib/nats.js'
import {runGtfsMatching} from './lib/match.js'
import {withSoftExit} from './lib/soft-exit.js'

const logger = createLogger('service')

const abortWithError = (err) => {
	logger.error(err)
	process.exit(1)
}

const natsLogger = createLogger('nats')
const {
	natsClient,
	natsJetstreamClient,
	natsJetstreamManager,
} = await connectToNats({
	logger: natsLogger,
})

const metricsServer = createMetricsServer()
metricsServer.start()
.then(() => {
	logger.info(`serving Prometheus metrics on port ${metricsServer.address().port}`)
}, abortWithError)

// todo: expose health check!
// - check if DB looks good

try {
	await runGtfsMatching({
		logger,
		natsClient,
		natsJetstreamClient,
		natsJetstreamManager,
	})

	withSoftExit(() => {
		natsClient.drain()
	})
} catch (err) {
	logger.error(err)
	process.exit(1)
}
