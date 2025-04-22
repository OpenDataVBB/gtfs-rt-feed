import {
	ok,
	deepStrictEqual,
} from 'node:assert/strict'
import isObject from 'lodash/isObject.js'
import mergeWith from 'lodash/mergeWith.js'

const unixTimestampFromIso8601 = (iso8601) => {
	const unixTimestamp = Date.parse(iso8601) / 1000 | 0
	ok(Number.isInteger(unixTimestamp), 'invalid ISO 8601 string')
	return unixTimestamp
}

// Merges objects deeply, but only lets entries of later objects overwrite those of former ones if the later ones are not null or undefined.
const mergeButPreferNonNull = (...objs) => {
	return mergeWith(
		{},
		...objs,
		(formerVal, laterVal) => {
			if (isObject(laterVal) || isObject(formerVal)) {
				return undefined // let mergeWith() handle recursion
			}
			return laterVal ?? formerVal ?? null
		},
	)
}
deepStrictEqual(
	mergeButPreferNonNull({
		foo: 0,
		bar: 2,
		baz: {_: null},
	}, {
		foo: null,
		bar: 3,
		baz: {_: 4},
	}),
	{
		foo: 0,
		bar: 3,
		baz: {_: 4},
	},
)
deepStrictEqual(
	mergeButPreferNonNull({
		trip: {
			trip_id: 'foo',
			schedule_relationship: 0,
		},
	}, {
		trip: {
			route_id: 'bar',
			schedule_relationship: null,
		},
	}),
	{
		trip: {
			trip_id: 'foo',
			route_id: 'bar',
			schedule_relationship: 0,
		},
	},
)

export {
	unixTimestampFromIso8601,
	mergeButPreferNonNull,
}
