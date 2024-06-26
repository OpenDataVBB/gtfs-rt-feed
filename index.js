import {createLogger} from './lib/logger.js'
import {connectToNats} from './lib/nats.js'
import {withSoftExit} from './lib/soft-exit.js'

const natsLogger = createLogger('nats')
const {natsClient} = await connectToNats({
	logger: natsLogger,
})

// todo: match with gtfs

withSoftExit(() => {
	natsClient.drain()
})
