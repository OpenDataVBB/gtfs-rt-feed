import pino from 'pino'

const createLogger = (name, opt = {}) => {
	return pino({
		name,
		level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
		base: {pid: process.pid},
		...opt,
	})
}

export {
	createLogger,
}
