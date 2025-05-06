import {
	ok,
	fail,
	deepStrictEqual,
} from 'node:assert/strict'
import omit from 'lodash/omit.js'
import maxBy from 'lodash/maxBy.js'
import {
	PREFIX as REDIS_PREFIX,
} from './caching.js'
import {
    mergeButPreferNonNull,
	unixTimestampFromIso8601,
} from './util.js'
import {connectToRedis} from './redis.js'

// The logic in this file uses three sources of information:
// 1. In almost all cases, a REF-AUS SollFahrt is sent ahead of time.
//     - With most organizations sending data to VBB's VDV API, the SollFahrt contains more fields, e.g. VonRichtungsText, Fahrradmitnahme, LinienfahrwegID, SollHalt.Haltestellenname.
// 2. Usually shortly before or right at the start of a trip "instance", an *exhaustive* AUS IstFahrt (with Komplettfahrt=true) is sent.
//     - With VBB's VDV API, this IstFahrt contains all IstHalts (that are known at thise time).
// 3. During the trip "instance", there will likely be more *partial* AUS IstFahrts with more up-to-date data for *some* of the IstHalts and/or new IstHalts.

// ---

const VDV_STORAGE_TTL = process.env.VDV_STORAGE_TTL
	? parseInt(process.env.VDV_STORAGE_TTL) * 1000
	: 32 * 60 * 60 * 1000 // 32 hours

const KIND_SOLLFAHRT = Symbol('REF-AUS SollFahrt')
const KIND_ISTFAHRT = Symbol('AUS IstFahrt')

const STORAGE_KEY_PREFIX = REDIS_PREFIX + 'vdv:'
const STORAGE_KEY_REF_AUS_SOLLFAHRT = 'ref_aus_soll'
const STORAGE_KEY_AUS_ISTFAHRT_KOMPLETTFAHRT = 'aus_komplett'
const STORAGE_KEY_AUS_ISTFAHRT_PARTIAL = 'aus_partial'

// Computes an ID that uniquely identifies the VDV *Fahrt (trip "instance" in GTFS parlance).
// Note: `vdvFahrt` can be either a REF-AUS SollFahrt or an AUS IstFahrt.
const computeVdvFahrtId = (vdvFahrt) => {
	if (!vdvFahrt.FahrtID) {
		return null
	}
	if (!vdvFahrt.FahrtID.FahrtBezeichner) {
		return null
	}
	if (!vdvFahrt.FahrtID.Betriebstag) {
		return null
	}
	return [
		vdvFahrt.FahrtID.Betriebstag,
		vdvFahrt.FahrtID.FahrtBezeichner,
	].join(':')
}

// > 5.2.2.2 Referenzierung der Fahrtdaten (FahrtRef)
// > […]
// > Für Installationen, bei denen auf den Soll-Datenaustausch mittel des REF-AUS-Dienstes verzichtet wird, können die Eckdaten einer Fahrt, nämlich erster und letzter Halt der Fahrt jeweils mit den Sollzeiten an diesen Halten verwendet werden um einen Bezug zum Sollfahrplan herzustellen. Damit ist die Verwendung des REF-AUS-Dienstes nicht zwingend erforderlich.
// > […]
// > 5.2.2.3 Informationen zum Halt (IstHalt)
// > […]
// > Hinweis: Die VDV-Schrift 454 ist so zu interpretieren, dass die Übertragung der Sollabfahrtszeit immer verpflichtend ist, außer es handelt sich um eine Endhaltestelle. Aus dieser Angabe kann damit die Reihenfolge der Haltepunkte abgeleitet werden.
const vdvHaltsAreEquivalent = (vdvHalt1) => {
	const istAbfahrt = vdvHalt1.Abfahrtszeit
		? unixTimestampFromIso8601(vdvHalt1.Abfahrtszeit)
		: null
	const istAnkunft = vdvHalt1.Ankunftszeit
		? unixTimestampFromIso8601(vdvHalt1.Ankunftszeit)
		: null
	const checkIfVdvHaltIsEquivalent = (vdvHalt2) => {
		if (!vdvHalt2.HaltID || vdvHalt2.HaltID !== vdvHalt1.HaltID) {
			return null
		}
		const sollAbfahrt = vdvHalt2.Abfahrtszeit
			? unixTimestampFromIso8601(vdvHalt2.Abfahrtszeit)
			: null
		const sollAnkunft = vdvHalt2.Ankunftszeit
			? unixTimestampFromIso8601(vdvHalt2.Ankunftszeit)
			: null
		// todo: what if there are >1 Halts stopping at the same HaltID within the same minute?
		return (
			(sollAbfahrt && sollAbfahrt === istAbfahrt)
			|| (sollAnkunft && sollAnkunft === istAnkunft)
		)
	}
	return checkIfVdvHaltIsEquivalent
}

const sortVdvHaltsByScheduledTime = (vdvHalt1, vdvHalt2) => {
	const dep1 = vdvHalt1.Abfahrtszeit
		? unixTimestampFromIso8601(vdvHalt1.Abfahrtszeit)
		: null
	const arr1 = vdvHalt1.Ankunftszeit
		? unixTimestampFromIso8601(vdvHalt1.Ankunftszeit)
		: null
	const dep2 = vdvHalt2.Abfahrtszeit
		? unixTimestampFromIso8601(vdvHalt2.Abfahrtszeit)
		: null
	const arr2 = vdvHalt2.Ankunftszeit
		? unixTimestampFromIso8601(vdvHalt2.Ankunftszeit)
		: null

	if (dep1 !== null && dep2 !== null) {
		return dep1 - dep2
	}
	if (arr1 !== null && arr2 !== null) {
		return arr1 - arr2
	}
	if (arr2 !== null && dep1 !== null && arr2 > dep1) {
		return -1
	}
	if (arr1 !== null && dep2 !== null && arr1 > dep2) {
		return 1
	}
	return 0
}

const makeSparseRefAusSollFahrt = (sollFahrt) => {
	return omit(sollFahrt, [
		'SollHalts',
	])
}
const makeSparseAusIstFahrt = (istFahrt) => {
	return omit(istFahrt, [
		'IstHalts',
	])
}

const pickNonNullWithLatestTimestamp = (vals) => { // [[val, iso8601], ...]
	const max = maxBy(
		vals.filter(([val]) => val !== null),
		([val, iso8601]) => iso8601 ? Date.parse(iso8601) : -Infinity,
	)
	return max ? max[0] : null
}
deepStrictEqual(
	pickNonNullWithLatestTimestamp([
		['2025-04-11T02:00:00.000+02:00', '2025-04-11T02:00:00.000+02:00'],
		['2025-04-11T02:00:00.002+02:00', '2025-04-11T02:00:00.002+02:00'],
	]),
	'2025-04-11T02:00:00.002+02:00',
)

// 1. soll may be null or an array with two items:
//     - soll[0] is a REF-AUS SollHalt
//     - soll[1] is the SollHalt's SollFahrt, which includes *all* SollHalts (known at that time)
// 2. komplettfahrtIst may be null or an array with two items:
//     - komplettfahrtIst[0] is an AUS IstHalt
//     - komplettfahrtIst[1] is the IstHalt's `Komplettfahrt=true` AUS IstFahrt, which includes all IstHalts (known at that time)
// 3. ist may be null or an array with two items:
//     - ist[0] is an AUS IstHalt
//     - ist[1] is the IstHalt's non-`Komplettfahrt=true` (sparse) IstFahrt
const mergeVdvHalts = (soll, komplettfahrtIst, ist) => {
	const [sollHalt, sollFahrt] = soll ?? [null, null]
	const sollFahrtZst = sollFahrt?.Zst ?? null

	const [komplettfahrtIstHalt, komplettfahrtIstFahrt] = komplettfahrtIst ?? [null, null]
	const komplettfahrtIstFahrtZst = komplettfahrtIstFahrt?.Zst ?? null

	const [istHalt, istFahrt] = ist ?? [null, null]
	const istFahrtZst = istFahrt?.Zst ?? null

	// general properties
	const durchfahrt = pickNonNullWithLatestTimestamp([
		[sollHalt?.Durchfahrt ?? null, sollFahrtZst],
		[komplettfahrtIstHalt?.Durchfahrt ?? null, komplettfahrtIstFahrtZst],
		[istHalt?.Durchfahrt ?? null, istFahrtZst],
	])
	// todo: handle & expose HinweisText
	// todo: handle & expose HaltestellenName?
	// todo: handle & expose RichtungsText/VonText?
	// todo: handle & expose LinienfahrwegID?
	// todo: what about additional unknown fields?

	// arrival properties
	const istAnkunftPrognose = pickNonNullWithLatestTimestamp([
		[komplettfahrtIstHalt?.IstAnkunftPrognose ?? null, komplettfahrtIstFahrtZst],
		[istHalt?.IstAnkunftPrognose ?? null, istFahrtZst],
	])
	const ankunftssteigText = pickNonNullWithLatestTimestamp([
		[komplettfahrtIstHalt?.AnkunftssteigText ?? null, komplettfahrtIstFahrtZst],
		[istHalt?.AnkunftssteigText ?? null, istFahrtZst],
	])
	const aussteigeverbot = pickNonNullWithLatestTimestamp([
		[sollHalt?.Aussteigeverbot ?? null, sollFahrtZst],
		[komplettfahrtIstHalt?.Aussteigeverbot ?? null, komplettfahrtIstFahrtZst],
		[istHalt?.Aussteigeverbot ?? null, istFahrtZst],
	])

	// departure properties
	const istAbfahrtPrognose = pickNonNullWithLatestTimestamp([
		[komplettfahrtIstHalt?.IstAbfahrtPrognose ?? null, komplettfahrtIstFahrtZst],
		[istHalt?.IstAbfahrtPrognose ?? null, istFahrtZst],
	])
	const abfahrtssteigText = pickNonNullWithLatestTimestamp([
		[komplettfahrtIstHalt?.AbfahrtssteigText ?? null, komplettfahrtIstFahrtZst],
		[istHalt?.AbfahrtssteigText ?? null, istFahrtZst],
	])
	const einsteigeverbot = pickNonNullWithLatestTimestamp([
		[sollHalt?.Einsteigeverbot ?? null, sollFahrtZst],
		[komplettfahrtIstHalt?.Einsteigeverbot ?? null, komplettfahrtIstFahrtZst],
		[istHalt?.Einsteigeverbot ?? null, istFahrtZst],
	])

	// merge everything
	return {
		HaltID: sollHalt?.HaltID ?? komplettfahrtIstHalt?.HaltID ?? istHalt?.HaltID,
		Ankunftszeit: sollHalt?.Ankunftszeit ?? komplettfahrtIstHalt?.Ankunftszeit ?? istHalt?.Ankunftszeit,
		IstAnkunftPrognose: istAnkunftPrognose,
		AnkunftssteigText: ankunftssteigText,
		Aussteigeverbot: aussteigeverbot,
		Abfahrtszeit: sollHalt?.Abfahrtszeit ?? komplettfahrtIstHalt?.Abfahrtszeit ?? istHalt?.Abfahrtszeit,
		IstAbfahrtPrognose: istAbfahrtPrognose,
		AbfahrtssteigText: abfahrtssteigText,
		Einsteigeverbot: einsteigeverbot,
		Durchfahrt: durchfahrt,
	}
}

const createMergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts = async (cfg) => {
	const {
		logger,
	} = cfg

	const storage = await connectToRedis()
	// As of ioredis@5.6.1, it doesn't support the HSETEX command, so we patch our client.
	// https://redis.io/docs/latest/commands/?group=hash
	if (typeof storage.hsetex !== 'function') {
		storage.addBuiltinCommand('hsetex')
	}

	const _storeVdvFahrt = async (vdvFahrt, kind) => {
		if (kind !== KIND_SOLLFAHRT && kind !== KIND_ISTFAHRT) {
			throw new Error(`kind must be either KIND_SOLLFAHRT or KIND_ISTFAHRT`)
		}
		const haltsKey = kind === KIND_SOLLFAHRT ? 'SollHalts' : 'IstHalts'
		const halts = vdvFahrt[haltsKey]
		ok(Array.isArray(halts), `vdvFahrt.${haltsKey} must be an array`)
		ok(halts.length > 0, `vdvFahrt.${haltsKey} must not be empty`)

		const fahrtId = computeVdvFahrtId(vdvFahrt)
		if (!fahrtId) {
			return null
		}
		const storageKey = STORAGE_KEY_PREFIX + fahrtId

		const isKomplettfahrt = vdvFahrt.Komplettfahrt === 'true'
		if (kind === KIND_ISTFAHRT && !isKomplettfahrt) {
			const fieldsArgs = halts.flatMap((istHalt, i) => {
				ok(istHalt.HaltID, `vdvFahrt.${haltsKey}[${i}].HaltID must not be missing`)
				let depOrArrPrefix = null
				let depOrArr = null
				if (istHalt.Abfahrtszeit) {
					depOrArrPrefix = 'dep'
					depOrArr = unixTimestampFromIso8601(istHalt.Abfahrtszeit)
				} else if (istHalt.Ankunftszeit) {
					depOrArrPrefix = 'arr'
					depOrArr = unixTimestampFromIso8601(istHalt.Ankunftszeit)
				} else {
					fail(`vdvFahrt.${haltsKey}[${i}] must have either .Abfahrtszeit or .Ankunftszeit`)
				}

				// In order to retain the IstFahrt's data, we create one that contains just our IstHalt.
				const sparseIstFahrt = omit(vdvFahrt, [
					'IstHalts',
				])

				// todo: what if there are >1 IstHalts stopping at the same HaltID within the same minute?
				// todo: what if an IstHalt is first seen only with an Ankunftszeit and later with an Abfahrtszeit? – it will be stored & read twice!
				const hashField = [
					STORAGE_KEY_AUS_ISTFAHRT_PARTIAL,
					istHalt.HaltID,
					depOrArrPrefix,
					depOrArr,
				].join(':')
				return [
					hashField,
					JSON.stringify({
						...istHalt,
						IstFahrt: sparseIstFahrt,
					}),
				]
			})

			// todo: support Valkey once they have a "Hash set + expiration" command
			await storage.hsetex(
				storageKey, // key of Redis Hash
				'PX', VDV_STORAGE_TTL, // expiration time in milliseconds
				'FIELDS', fieldsArgs.length / 2, // number of Hash fields to set
				...fieldsArgs,
			)
		} else {
			const field = kind === KIND_SOLLFAHRT
				? STORAGE_KEY_REF_AUS_SOLLFAHRT
				: STORAGE_KEY_AUS_ISTFAHRT_KOMPLETTFAHRT

			// todo: support Valkey once they have a "Hash set + expiration" command
			await storage.hsetex(
				storageKey, // key of Redis Hash
				'PX', VDV_STORAGE_TTL, // expiration time in milliseconds
				'FIELDS', 1, // number of Hash fields to set
				field,
				JSON.stringify(vdvFahrt), // value
			)
		}
	}
	const storeRefAusSollFahrt = async (sollFahrt) => {
		await _storeVdvFahrt(sollFahrt, KIND_SOLLFAHRT)
	}
	const storeAusIstFahrt = async (istFahrt) => {
		await _storeVdvFahrt(istFahrt, KIND_ISTFAHRT)
	}

	// Given a REF-AUS SollFahrt or AUS IstFahrt, reads
	// - the REF-AUS SollFahrt (if stored),
	// - the Komplettfahrt=true AUS IstFahrt (if stored),
	// - and all stored partial AUS IstFahrts.
	// todo: DRY with https://github.com/derhuerst/iris-gtfs-rt-feed/blob/83dcc091777753194510f7c85563a6588be05154/lib/iris.js#L311-L333
	const readEquivalentVdvFahrts = async (vdvFahrt) => {
		const fahrtId = computeVdvFahrtId(vdvFahrt)
		if (!fahrtId) {
			return []
		}
		const storageKey = STORAGE_KEY_PREFIX + fahrtId

		const res = {
			refAusSollFahrt: null,
			komplettfahrtAusIstFahrt: null,
			partialAusIstFahrts: [],
		}

		// load from storage
		const hash = await storage.hgetall(storageKey)
		for (const [key, val] of Object.entries(hash)) {
			const [kindPart] = key.split(':')
			const item = JSON.parse(val)
			if (kindPart === STORAGE_KEY_REF_AUS_SOLLFAHRT) {
				res.refAusSollFahrt = item
			} else if (kindPart === STORAGE_KEY_AUS_ISTFAHRT_KOMPLETTFAHRT) {
				res.komplettfahrtAusIstFahrt = item
			} else if (kindPart === STORAGE_KEY_AUS_ISTFAHRT_PARTIAL) {
				res.partialAusIstFahrts.push(item)
			} else {
				// todo: warn-log?
			}
		}

		// sort partial IstFahrts by their first (and only) IstHalt
		res.partialAusIstFahrts = res.partialAusIstFahrts.sort(sortVdvHaltsByScheduledTime)
		return res
	}

	// todo:
	// > 6.1.3 Aggregation von Meldungen zu einer Fahrt
	// > […]
	// > Zusatzfahrt: Dieses Element wird nur in Zusammenhang mit einer Komplettfahrt verwendet. In Folgemeldungen ist es nicht mehr notwendig.
	// > FaelltAus: Dieses Element kann die folgenden Ausprägungen annehmen, für die die jeweilige Bedeutung angegeben ist:
	// > - Vorhanden mit Wert true: Fahrt fällt aus
	// > - Nicht vorhanden in Komplettfahrt: Fährt.
	// > - Nicht vorhanden in Nicht-Komplettfahrt: Keine Änderung zu letzter Meldung
	// > - Vorhanden in Nicht-Komplettfahrt mit Wert false: Möglichst nicht verwenden, um eine Ausfallmeldung zurückzusetzen. Bedeutet: Fährt, Verspätungszustand aus früheren Meldungen nicht rekonstruierbar. Neue Prognose mitsenden oder Komplettfahrt verwenden.
	// > […]
	// > Zusatzhalt: Dieses Element wird nur in Zusammenhang mit einer Komplettfahrt verwendet. In Folgemeldungen ist es nicht mehr notwendig.

	// todo:
	// > 6.1.10 Außerplanmäßige Abmeldung
	// > Falls sich ein Fahrzeug von seinem Umlauf abmeldet, oder funktechnisch nicht mehr erreichbar ist, muss das ITCS die Möglichkeit haben, eine vorher gemeldete Prognose wieder zurückzunehmen. In diesem Fall muss das ITCS für jede bereits gemeldete Fahrt eine Fahrplanabweichungsmeldung mit dem Attribut PrognoseMoeglich = false an das Auskunftssystem senden. Somit weiß das Auskunftssystem über den Ungenauigkeitsstatus dieser Fahrten Bescheid und kann sie dem Kunden entsprechend kennzeichnen. Nach einer Meldung mit dem Attribut PrognoseMoeglich = false hat die Fahrt den gleichen Status, als ob sie bisher nicht gemeldet worden ist.

	const mergeVdvFahrtWithEquivalentRefAusSollFahrtAndAusIstFahrts = async (vdvFahrt) => {
		const {
			refAusSollFahrt,
			komplettfahrtAusIstFahrt,
			partialAusIstFahrts,
		} = await readEquivalentVdvFahrts(vdvFahrt)

		// merge {Soll,Ist}Fahrt properties
		const mergedIstFahrt = mergeButPreferNonNull(
			refAusSollFahrt ? makeSparseRefAusSollFahrt(refAusSollFahrt) : {},
			komplettfahrtAusIstFahrt ? makeSparseAusIstFahrt(komplettfahrtAusIstFahrt) : {},
			...partialAusIstFahrts.map(ausIstHaltWithIstFahrt => ausIstHaltWithIstFahrt.IstFahrt),
		)
		mergedIstFahrt['$BestaetigungZst'] = pickNonNullWithLatestTimestamp([
			[refAusSollFahrt?.['$BestaetigungZst'] ?? null, refAusSollFahrt?.['$BestaetigungZst'] ?? null],
			[komplettfahrtAusIstFahrt?.['$BestaetigungZst'] ?? null, komplettfahrtAusIstFahrt?.['$BestaetigungZst'] ?? null],
			...partialAusIstFahrts.map((ausIstHaltWithIstFahrt) => {
				return  [ausIstHaltWithIstFahrt.IstFahrt['$BestaetigungZst'] ?? null, ausIstHaltWithIstFahrt.IstFahrt['$BestaetigungZst'] ?? null]
			}),
		])
		mergedIstFahrt.Zst = pickNonNullWithLatestTimestamp([
			[refAusSollFahrt?.Zst ?? null, refAusSollFahrt?.Zst ?? null],
			[komplettfahrtAusIstFahrt?.Zst ?? null, komplettfahrtAusIstFahrt?.Zst ?? null],
			...partialAusIstFahrts.map((ausIstHaltWithIstFahrt) => {
				return  [ausIstHaltWithIstFahrt.IstFahrt.Zst ?? null, ausIstHaltWithIstFahrt.IstFahrt.Zst ?? null]
			}),
		])
		// todo: set PrognoseMoeglich=true as soon as there are >0 IstFahrts?

		// merge {Soll,Ist}Halts
		// todo: refactor this, the code is quite verbose for what it achieves
		if (komplettfahrtAusIstFahrt) {
			mergedIstFahrt.Komplettfahrt = 'true'
			mergedIstFahrt.PrognoseMoeglich = 'true'
			mergedIstFahrt.IstHalts = komplettfahrtAusIstFahrt.IstHalts.map((komplettfahrtAusIstHalt) => {
				const isEquivalentVdvHalt = vdvHaltsAreEquivalent(komplettfahrtAusIstHalt)

				const refAusSollHalt = refAusSollFahrt
					? refAusSollFahrt.SollHalts.find(isEquivalentVdvHalt)
					: null
				const ausIstHaltWithIstFahrt = partialAusIstFahrts.find(isEquivalentVdvHalt) ?? null

				return mergeVdvHalts(
					// soll
					refAusSollHalt ? [refAusSollHalt, refAusSollFahrt] : null,
					// komplettfahrtIst
					[komplettfahrtAusIstHalt, komplettfahrtAusIstFahrt],
					// ist
					ausIstHaltWithIstFahrt ? [ausIstHaltWithIstFahrt, ausIstHaltWithIstFahrt.IstFahrt] : null,
				)
			})
		} else if (refAusSollFahrt) {
			mergedIstFahrt.IstHalts = refAusSollFahrt.SollHalts.map((refAusSollHalt) => {
				const isEquivalentVdvHalt = vdvHaltsAreEquivalent(refAusSollHalt)

				const ausIstHaltWithIstFahrt = partialAusIstFahrts.find(isEquivalentVdvHalt) ?? null

				return mergeVdvHalts(
					// soll
					[refAusSollHalt, refAusSollFahrt],
					// komplettfahrtIst
					null,
					// ist
					ausIstHaltWithIstFahrt ? [ausIstHaltWithIstFahrt, ausIstHaltWithIstFahrt.IstFahrt] : null,
				)
			})
		} else if (partialAusIstFahrts.length > 0) {
			mergedIstFahrt.PrognoseMoeglich = 'true'
			mergedIstFahrt.IstHalts = partialAusIstFahrts
				.map(ausIstHaltWithIstFahrt => omit(ausIstHaltWithIstFahrt, ['IstFahrt']))
		} else {
			// this shouldn't ever happen...?
			const err = new Error('none of refAusSollFahrt/komplettfahrtAusIstFahrt/partialAusIstFahrts present')
			err.vdvFahrt = vdvFahrt
			throw err
		}

		logger.trace({
			mergedIstFahrt,
			refAusSollFahrt,
			komplettfahrtAusIstFahrt,
			partialAusIstFahrts,
		}, 'merged vdvFahrt with equivalent REF-AUS Sollfahrt & AUS IstFahrt (if stored)')
		return {
			hasRefAusSollFahrt: !!refAusSollFahrt,
			hasKomplettfahrtAusIstFahrt: !!komplettfahrtAusIstFahrt,
			hasPartialAusIstFahrts: partialAusIstFahrts.length > 0,
			mergedIstFahrt,
		}
	}

	const stop = async () => {
		await storage.quit()
	}

	const res = {
		storeRefAusSollFahrt,
		storeAusIstFahrt,
		readEquivalentVdvFahrts,
		mergeVdvFahrtWithEquivalentRefAusSollFahrtAndAusIstFahrts,
		stop,
	}
	Object.defineProperty(res, 'storage', {value: storage})
	return res
}

export {
	mergeVdvHalts,
	createMergeVdvFahrtWithRefAusSollFahrtAndAusIstFahrts,
}
