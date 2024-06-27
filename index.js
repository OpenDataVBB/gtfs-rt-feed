import {createLogger} from './lib/logger.js'
import {connectToNats} from './lib/nats.js'
import {runGtfsMatching} from './lib/match.js'
import {withSoftExit} from './lib/soft-exit.js'

const logger = createLogger('service')

const natsLogger = createLogger('nats')
const {natsClient} = await connectToNats({
	logger: natsLogger,
})

runGtfsMatching({
	natsClient,
})

withSoftExit(() => {
	natsClient.drain()
})
