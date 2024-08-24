const stripDataProviderPrefixFromAusHaltID = (ausHaltId) => {
	// remove data provider prefix, e.g.
	// - `ODEG_900210771`
	return /^[A-Z]+_/.test(ausHaltId)
		? ausHaltId.slice(ausHaltId.indexOf('_') + 1)
		: ausHaltId
}

export {
	stripDataProviderPrefixFromAusHaltID,
}
