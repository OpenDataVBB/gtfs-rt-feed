import {
	normalizeStopName,
	normalizeLineName,
	normalizeTripHeadsign,
} from './normalize.js'

const gtfsInfo = {
	idNamespace: 'vbb',
	endpointName: 'gtfs',
	normalizeStopName,
	normalizeLineName,
	normalizeTripHeadsign,
}

export default gtfsInfo
