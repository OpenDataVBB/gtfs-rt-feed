// copied from https://github.com/derhuerst/hafas-gtfs-rt-feed/blob/8.2.6/lib/soft-exit.js

const withSoftExit = (softExit) => {
	let softExiting = false
	const onExitSignal = () => {
		// If soft exit is running or didn't work, exit forcefully.
		if (softExiting) {
			process.exit()
			return;
		}

		softExit()
		softExiting = true
		setTimeout(() => process.exit(), 3 * 1000).unref()
	}

	process.on('SIGINT', onExitSignal)
	process.on('SIGTERM', onExitSignal)
}

export {
	withSoftExit,
}
