const OPERATORS = [
	// Adapted from the 2024-08-16 VBB GTFS dataset's agency.txt file.
	{
		ausFahrtBezeichnerSuffix: null, // todo?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'S-Bahn Berlin GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: 'OVG',
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Oberhavel Verkehrsgesellschaft mbH',
	},
	{
		ausFahrtBezeichnerSuffix: 'VBBr', // note the casing
		gtfsAgencyName: 'Verkehrsbetriebe Brandenburg an der Havel GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: 'SVF',
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Stadtverkehrsgesellschaft mbH Frankfurt (Oder)',
	},
	{
		ausFahrtBezeichnerSuffix: 'HVG',
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Havelbus Verkehrsgesellschaft mbH',
	},
	{
		ausFahrtBezeichnerSuffix: 'UVG',
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Uckermärkische Verkehrsgesellschaft mbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'DB Regio AG',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `anger-busvermietung`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Günter Anger Güterverkehrs GmbH & Co. Omnibusvermietung KG',
	},
	{
		ausFahrtBezeichnerSuffix: 'VIP',
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Verkehrsbetrieb Potsdam GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `bbg-eberswalde`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Barnimer Busgesellschaft mbH',
	},
	{
		ausFahrtBezeichnerSuffix: null,
		ausLinienIdOperatorPart: 'vtf', // lower-case!
		gtfsAgencyName: 'Verkehrsgesellschaft Teltow-Fläming mbH',
	},
	{
		ausFahrtBezeichnerSuffix: 'RVS',
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Regionale Verkehrsgesellschaft Dahme-Spreewald mbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `verkehrsmanagement-elbeelster`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Verkehrsmanagement Elbe-Elster GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `vgosl`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Verkehrsgesellschaft Oberspreewald-Lausitz mbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `behrendt-touristik`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Fritz Behrendt OHG',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `busreisen-glaser`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Glaser',
	},
	{
		ausFahrtBezeichnerSuffix: 'SRS', // 'srs-tram'
		gtfsAgencyName: 'Schöneicher Rüdersdorfer Straßenbahn GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `strausberger-eisenbahn`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Strausberger Eisenbahn GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `cottbusverkehr`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Cottbusverkehr GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `bos-fw`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Busverkehr Oder-Spree GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: 'NEB',
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'NEB Betriebsgesellschaft mbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'A. Reich GmbH Busbetrieb',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Sabinchen Touristik GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `fahrschuleschmidt`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Busverkehr Gerd Schmidt',
	},
	{
		ausFahrtBezeichnerSuffix: 'ORP',
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'ORP Ostprignitz-Ruppiner Personennahverkehrsgesellschaft mbH',
	},
	{
		ausFahrtBezeichnerSuffix: 'ODEG',
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'ODEG Ostdeutsche Eisenbahn GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `hanseatische-eisenbahn`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Hanseatische Eisenbahn',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `dbregiobus-ost`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'DB Regio Bus Ost GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `lange-tours`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Lange',
	},
	{
		ausFahrtBezeichnerSuffix: 'BVG',
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Berliner Verkehrsbetriebe',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `mitteldeutsche-regiobahn`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'Bayerische Oberlandbahn GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `prignitz-bus`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'prignitzbus',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `mo-bus`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'mobus Märkisch-Oderland Bus GmbH',
	},
	{
		ausFahrtBezeichnerSuffix: null, // todo: `regiobus-pm`?
		ausLinienIdOperatorPart: null,
		gtfsAgencyName: 'regiobus Potsdam Mittelmark GmbH',
	},

	// todo: what are these? taken from VBB's AUS FahrtBezeichners
	// - BNO, e.g.
	// 		- FahrtBezeichner `102-824-5824195#BNO` with LinienID `824`
	// - CV, e.g.
	// 		- FahrtBezeichner `170622-18163379#CV` with LinienID `43`
	// - DB_BUS, e.g.
	// 		- FahrtBezeichner `5424-rbrSNB-278144-163500#DB_BUS` with LinienID `858`
	// - SBB, e.g.
	// 		- FahrtBezeichner `579117#SBB` with LinienID `579`
	// - VETTERZDD, e.g.
	// 		- FahrtBezeichner `39202505#VETTERZDD` with LinienID `X2`
	// - VGB, e.g.
	// 		- FahrtBezeichner `591-00015-1#VGB` with LinienID `BVSG601`

]

// These are not in the VBB GTFS, because
// ## they are not part of VBB
// - Nahverkehrsgesellschaft Jerichower Land (operates in DE-SA [0][1]), e.g.
// 		- FahrtBezeichner `740526-800826620000#Nahverkehrsgesellschaft Jerichower Land` with LinienID `740`
// [0] https://njl-burg.de/ueber-uns/
// [1] https://de.wikipedia.org/wiki/Landkreis_Jerichower_Land

export default OPERATORS
