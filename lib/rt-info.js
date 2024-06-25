import {
	normalizeStopName,
	normalizeLineName,
	normalizeTripHeadsign,
} from './normalize.js'

const rtInfo = {
	idNamespace: 'vbb',
	endpointName: 'vdv',
	normalizeStopName,
	normalizeLineName,
	normalizeTripHeadsign,
}

export default rtInfo
