import pino from 'pino'

const createLogger = (name) => {
	return pino({
		name,
		level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
		base: {pid: process.pid},
	})
}

export {
	createLogger,
}
