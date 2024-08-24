import pino from 'pino'

const createLogger = (name, opt = {}) => {
	return pino({
		name,
		level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
		base: {pid: process.pid},
		// todo?
		// redact: [
		// 	// With network & HAFAS errors, hafas-client exposes the entire fetch request.
		// 	// We don't want all the nitty-gritty details though.
		// 	'err.fetchRequest.agent',

		// 	'err.fetchRequest.headers.authorization',
		// 	'err.fetchRequest.headers.Authorization',
		// ],
		...opt,
	})
}

export {
	createLogger,
}
