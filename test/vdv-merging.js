import {test, beforeEach, after} from 'node:test'
import {strictEqual, deepStrictEqual} from 'node:assert/strict'
import omit from 'lodash/omit.js'
import {createLogger} from '../lib/logger.js'
import {
	createMergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts,
	mergeVdvHalts,
} from '../lib/merge-vdv-sollfahrts-istfahrts.js'

import ausIstFahrt92_1 from './fixtures/aus-istfahrt-2025-04-11-76528-00066-1_VIP-1.js'
import ausIstFahrt92_2 from './fixtures/aus-istfahrt-2025-04-11-76528-00066-1_VIP-2.js'
import ausIstFahrt92_3 from './fixtures/aus-istfahrt-2025-04-11-76528-00066-1_VIP-3.js'
import ausIstFahrt92_4 from './fixtures/aus-istfahrt-2025-04-11-76528-00066-1_VIP-4.js'
import refAusSollFahrt92 from './fixtures/ref-aus-sollfahrt-2025-04-11-76528-00066-1_VIP.js'
import mergedAusIstFahrt92All from './fixtures/merged-aus-istfahrt-2025-04-11-76528-00066-1_VIP-all.js'
import mergedAusIstFahrt92NoKomplettfahrt from './fixtures/merged-aus-istfahrt-2025-04-11-76528-00066-1_VIP-no-komplettfahrt.js'
import mergedAusIstFahrt92JustPartialIstFahrts from './fixtures/merged-aus-istfahrt-2025-04-11-76528-00066-1_VIP-just-partial-istfahrts.js'

const {
	storage: _vdvMergingStorage,
	storeRefAusSollFahrt,
	storeAusIstFahrt,
	readEquivalentVdvFahrts,
	mergeVdvFahrtWithEquivalentRefAusSollFahrtAndAusIstFahrts,
	stop: stopVdvMerging,
} = await createMergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts({
	logger: createLogger('vdv-merging-test', {
		level: 'fatal',
	})
})
beforeEach(async () => {
	await _vdvMergingStorage.flushdb()
})
after(async () => {
	await stopVdvMerging()
})

const fahrtID = {
	FahrtBezeichner: 'some FaHrT-bEzEiChNeR',
	Betriebstag: '2025-04-11',
}

const refAusSollHalt2 = {
	HaltID: '234',
	HaltestellenName: 'two three FoUr',
	Abfahrtszeit: null,
	AbfahrtssteigText: null,
	Einsteigeverbot: null,
	Ankunftszeit: '2025-04-11T02:03:04+02:00',
	AnkunftssteigText: null,
	Aussteigeverbot: null,
	Durchfahrt: 'false',
	RichtungsText: null,
	VonText: null,
	LinienfahrwegID: null,
}
const refAusSollFahrt = {
	FahrtID: fahrtID,
	Zst: null,
	LinienID: 'some-line',
	LinienText: 'some LiNe',
	RichtungsText: 'some DiReCtIoN',
	PrognoseMoeglich: null,
	Zusatzfahrt: null,
	FaelltAus: null,
	FahrzeugTypID: null,
	SollHalts: [
		{
			HaltID: '123',
			HaltestellenName: 'one two ThReE',
			Abfahrtszeit: '2025-04-11T01:02:03+02:00',
			AbfahrtssteigText: null,
			Einsteigeverbot: null,
			Ankunftszeit: null,
			AnkunftssteigText: null,
			Aussteigeverbot: null,
			Durchfahrt: null,
			RichtungsText: null,
			VonText: null,
			LinienfahrwegID: null,
		},
		refAusSollHalt2,
	],
	'$BestaetigungZst': '2025-04-11T15:47:27.498Z',
}

const komplettfahrtAusIstHalt2 = {
	HaltID: '234',
	Ankunftszeit: '2025-04-11T02:03:04+02:00',
	IstAnkunftPrognose: '2025-04-11T03:04:05+02:00',
	AnkunftssteigText: 'arrival gate',
	Aussteigeverbot: null,
	Abfahrtszeit: '2025-04-11T02:03:14+02:00',
	IstAbfahrtPrognose: '2025-04-11T03:04:15+02:00',
	AbfahrtssteigText: null,
	Einsteigeverbot: 'true',
	Durchfahrt: null,
}
const komplettfahrtAusIstFahrt = {
	FahrtID: fahrtID,
	Zst: '2025-04-11T02:00:00.000+02:00',
	LinienID: 'some-line',
	PrognoseMoeglich: 'true',
	Zusatzfahrt: null,
    Komplettfahrt: 'true',
    UmlaufID: '9204',
	FaelltAus: null,
	FahrzeugTypID: 'normal bus',
	IstHalts: [
		{
			HaltID: '123',
			Abfahrtszeit: '2025-04-11T01:02:03+02:00',
			AbfahrtssteigText: null,
			Einsteigeverbot: null,
			Ankunftszeit: null,
			AnkunftssteigText: null,
			Aussteigeverbot: null,
			Durchfahrt: null,
			RichtungsText: null,
			VonText: null,
			LinienfahrwegID: null,
		},
		komplettfahrtAusIstHalt2,
	],
	'$BestaetigungZst': '2025-04-11T01:02:02Z',
}

const ausIstHalt = {
	HaltID: '234',
	Ankunftszeit: '2025-04-11T02:03:04+02:00',
	IstAnkunftPrognose: null,
	AnkunftssteigText: null,
	Aussteigeverbot: null,
	Abfahrtszeit: '2025-04-11T02:03:14+02:00',
	IstAbfahrtPrognose: '2025-04-11T04:05:16+02:00',
	AbfahrtssteigText: 'departure gate',
	Einsteigeverbot: null,
	Durchfahrt: null,
}
const ausIstFahrt = {
	FahrtID: fahrtID,
	Zst: '2025-04-11T02:00:00.002+02:00',
	PrognoseMoeglich: 'true',
    Komplettfahrt: null,
	IstHalts: [
		ausIstHalt,
	],
	'$BestaetigungZst': '2025-04-11T01:01:01Z',
}

test('correctly merges REF-AUS SollFahrt, Komplettfahrt=true AUS IstFahrt & sparse IstFahrt', async (t) => {
	const merged = await mergeVdvHalts(
		[refAusSollHalt2, refAusSollFahrt],
		[komplettfahrtAusIstHalt2, komplettfahrtAusIstFahrt],
		[ausIstHalt, ausIstFahrt],
	)
	deepStrictEqual(merged, {
		HaltID: '234',
		Ankunftszeit: '2025-04-11T02:03:04+02:00',
		IstAnkunftPrognose: '2025-04-11T03:04:05+02:00', // from komplettfahrtAusIstHalt2
		AnkunftssteigText: 'arrival gate', // from komplettfahrtAusIstHalt2
		Aussteigeverbot: null,
		Abfahrtszeit: '2025-04-11T02:03:14+02:00',
		IstAbfahrtPrognose: '2025-04-11T04:05:16+02:00', // from ausIstHalt
		AbfahrtssteigText: 'departure gate', // from ausIstHalt
		Einsteigeverbot: 'true', // from komplettfahrtAusIstHalt2
		Durchfahrt: 'false', // from refAusSollHalt2
	})
})

test('correctly merges REF-AUS SollFahrt & Komplettfahrt=true AUS IstFahrt', async (t) => {
	const merged = await mergeVdvHalts(
		[refAusSollHalt2, refAusSollFahrt],
		[komplettfahrtAusIstHalt2, komplettfahrtAusIstFahrt],
		null,
	)
	deepStrictEqual(merged, {
		HaltID: '234',
		Ankunftszeit: '2025-04-11T02:03:04+02:00',
		IstAnkunftPrognose: '2025-04-11T03:04:05+02:00', // from komplettfahrtAusIstHalt2
		AnkunftssteigText: 'arrival gate', // from komplettfahrtAusIstHalt2
		Aussteigeverbot: null,
		Abfahrtszeit: '2025-04-11T02:03:14+02:00',
		IstAbfahrtPrognose: '2025-04-11T03:04:15+02:00', // from komplettfahrtAusIstHalt2
		AbfahrtssteigText: null,
		Einsteigeverbot: 'true', // from komplettfahrtAusIstHalt2
		Durchfahrt: 'false', // from refAusSollHalt2
	})
})

test('correctly merges REF-AUS SollFahrt & sparse IstFahrt', async (t) => {
	const merged = await mergeVdvHalts(
		[refAusSollHalt2, refAusSollFahrt],
		null,
		[ausIstHalt, ausIstFahrt],
	)
	deepStrictEqual(merged, {
		HaltID: '234',
		Ankunftszeit: '2025-04-11T02:03:04+02:00',
		IstAnkunftPrognose: null,
		AnkunftssteigText: null,
		Aussteigeverbot: null,
		Abfahrtszeit: '2025-04-11T02:03:14+02:00',
		IstAbfahrtPrognose: '2025-04-11T04:05:16+02:00', // from ausIstHalt
		AbfahrtssteigText: 'departure gate', // from ausIstHalt
		Einsteigeverbot: null,
		Durchfahrt: 'false', // from refAusSollHalt2
	})
})

test('correctly merges Komplettfahrt=true AUS IstFahrt & sparse IstFahrt', async (t) => {
	const merged = await mergeVdvHalts(
		null,
		[komplettfahrtAusIstHalt2, komplettfahrtAusIstFahrt],
		[ausIstHalt, ausIstFahrt],
	)
	deepStrictEqual(merged, {
		HaltID: '234',
		Ankunftszeit: '2025-04-11T02:03:04+02:00',
		IstAnkunftPrognose: '2025-04-11T03:04:05+02:00', // from komplettfahrtAusIstHalt2
		AnkunftssteigText: 'arrival gate', // from komplettfahrtAusIstHalt2
		Aussteigeverbot: null,
		Abfahrtszeit: '2025-04-11T02:03:14+02:00',
		IstAbfahrtPrognose: '2025-04-11T04:05:16+02:00', // from ausIstHalt
		AbfahrtssteigText: 'departure gate', // from ausIstHalt
		Einsteigeverbot: 'true', // from komplettfahrtAusIstHalt2
		Durchfahrt: null,
	})
})

test('correctly stores & merges REF-AUS SollFahrt, Komplettfahrt=true AUS IstFahrt & sparse IstFahrt', async (t) => {
	await storeRefAusSollFahrt(refAusSollFahrt92)
	await storeAusIstFahrt(ausIstFahrt92_1) // Komplettfahrt=true
	await storeAusIstFahrt(ausIstFahrt92_2)
	await storeAusIstFahrt(ausIstFahrt92_3) // Komplettfahrt=true
	await storeAusIstFahrt(ausIstFahrt92_4)

	const equivalents = await readEquivalentVdvFahrts(ausIstFahrt92_4)
	deepStrictEqual(equivalents, {
		refAusSollFahrt: refAusSollFahrt92,
		// ausIstFahrt92_3 & ausIstFahrt92_3 are Komplettfahrt=true IstFahrts, ausIstFahrt92_2 & ausIstFahrt92_4 each contain only 1 IstHalt.
		komplettfahrtAusIstFahrt: ausIstFahrt92_3,
		partialAusIstFahrts: [
			// Note: These are sorted by time!
			{
				...ausIstFahrt92_2.IstHalts[0],
				IstFahrt: omit(ausIstFahrt92_2, ['IstHalts']),
			},
			{
				...ausIstFahrt92_4.IstHalts[0],
				IstFahrt: omit(ausIstFahrt92_4, ['IstHalts']),
			},
		],
	})

	const {
		hasRefAusSollFahrt,
		hasKomplettfahrtAusIstFahrt,
		hasPartialAusIstFahrts,
		mergedIstFahrt: merged,
	} = await mergeVdvFahrtWithEquivalentRefAusSollFahrtAndAusIstFahrts(ausIstFahrt92_4)
	strictEqual(hasRefAusSollFahrt, true)
	strictEqual(hasKomplettfahrtAusIstFahrt, true)
	strictEqual(hasPartialAusIstFahrts, true)
	deepStrictEqual(merged, mergedAusIstFahrt92All)
})

test('correctly stores & merges REF-AUS SollFahrt & sparse IstFahrts', async (t) => {
	await storeRefAusSollFahrt(refAusSollFahrt92)
	await storeAusIstFahrt(ausIstFahrt92_2)
	await storeAusIstFahrt(ausIstFahrt92_4)

	const equivalents = await readEquivalentVdvFahrts(ausIstFahrt92_4)
	deepStrictEqual(equivalents, {
		refAusSollFahrt: refAusSollFahrt92,
		komplettfahrtAusIstFahrt: null,
		// ausIstFahrt92_2 & ausIstFahrt92_4 each contain only 1 IstHalt.
		partialAusIstFahrts: [
			// Note: These are sorted by time!
			{
				...ausIstFahrt92_2.IstHalts[0],
				IstFahrt: omit(ausIstFahrt92_2, ['IstHalts']),
			},
			{
				...ausIstFahrt92_4.IstHalts[0],
				IstFahrt: omit(ausIstFahrt92_4, ['IstHalts']),
			},
		],
	})

	const {
		hasRefAusSollFahrt,
		hasKomplettfahrtAusIstFahrt,
		hasPartialAusIstFahrts,
		mergedIstFahrt: merged,
	} = await mergeVdvFahrtWithEquivalentRefAusSollFahrtAndAusIstFahrts(ausIstFahrt92_4)
	strictEqual(hasRefAusSollFahrt, true)
	strictEqual(hasKomplettfahrtAusIstFahrt, false)
	strictEqual(hasPartialAusIstFahrts, true)
	deepStrictEqual(merged, mergedAusIstFahrt92NoKomplettfahrt)
})

test('correctly stores & merges sparse IstFahrts (only)', async (t) => {
	await storeAusIstFahrt(ausIstFahrt92_2)
	await storeAusIstFahrt(ausIstFahrt92_4)

	const equivalents = await readEquivalentVdvFahrts(ausIstFahrt92_4)
	deepStrictEqual(equivalents, {
		refAusSollFahrt: null,
		komplettfahrtAusIstFahrt: null,
		// ausIstFahrt92_2 & ausIstFahrt92_4 each contain only 1 IstHalt.
		partialAusIstFahrts: [
			// Note: These are sorted by time!
			{
				...ausIstFahrt92_2.IstHalts[0],
				IstFahrt: omit(ausIstFahrt92_2, ['IstHalts']),
			},
			{
				...ausIstFahrt92_4.IstHalts[0],
				IstFahrt: omit(ausIstFahrt92_4, ['IstHalts']),
			},
		],
	})

	const {
		hasRefAusSollFahrt,
		hasKomplettfahrtAusIstFahrt,
		hasPartialAusIstFahrts,
		mergedIstFahrt: merged,
	} = await mergeVdvFahrtWithEquivalentRefAusSollFahrtAndAusIstFahrts(ausIstFahrt92_4)
	strictEqual(hasRefAusSollFahrt, false)
	strictEqual(hasKomplettfahrtAusIstFahrt, false)
	strictEqual(hasPartialAusIstFahrts, true)
	deepStrictEqual(merged, mergedAusIstFahrt92JustPartialIstFahrts)
})
