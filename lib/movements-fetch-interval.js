import {DateTime} from 'luxon'

const TIMEZONE = 'Europe/Berlin'
const LOCALE = 'de-DE'

const DAY_INTERVAL = process.env.FETCH_TILES_INTERVAL
	? parseInt(process.env.FETCH_TILES_INTERVAL)
	: 60 * 1000
const NIGHT_INTERVAL = DAY_INTERVAL * 3

const movementsFetchInterval = () => {
	const {hour} = DateTime
	.fromMillis(Date.now(), {
		zone: TIMEZONE,
		locale: LOCALE,
	})

	return hour >= 6 && hour < 22
		? DAY_INTERVAL
		: NIGHT_INTERVAL
}

export default movementsFetchInterval
