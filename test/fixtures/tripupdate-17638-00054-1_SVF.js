const tripUpdate981 = {
	"trip": {
		"trip_id": "234717603",
		"route_id": "1871_700",
		"direction_id": "0"
	},
	"vehicle": {
		// todo
	},
	"stop_time_update": [
		{
			// todo: once Schedule data has stop/station topology, expect matching stop_sequence & stop_id here
			"stop_sequence": null,
			"stop_id": "de:12053:900360079::3",
			"arrival": {
				"time": 1719476640,
				"delay": null, // not provided by AUS IstFahrt
			},
			"departure": {
				"time": 1719476640,
				"delay": 0,
			},
		},
		{
			// todo: once Schedule data has stop/station topology, expect matching stop_sequence & stop_id here
			"stop_sequence": null,
			"stop_id": "900360135",
			"arrival": {
				"time": 1719476857,
				"delay": 37,
			},
			"departure": {
				"time": 1719476856,
				"delay": 36,
			},
		},
		// todo: AUS IstHalt uses HaltID `ODEG_122207` instead of `ODEG_900360222`
		{
			// todo: once Schedule data has stop/station topology, expect matching stop_sequence & stop_id here
			"stop_sequence": null,
			"stop_id": "122207",
			"arrival": {
				"time": 1719476880,
				"delay": null, // no Schedule match -> no delay data
			},
			"departure": {
				"time": 1719476880,
				"delay": null, // no Schedule match -> no delay data
			},
		},
		{
			// todo: once Schedule data has stop/station topology, expect matching stop_sequence & stop_id here
			"stop_sequence": null,
			"stop_id": "900360022",
			"arrival": {
				"time": 1719477075, // 2024-06-27T10:31:15+02:00
				"delay": 195,
			},
			"departure": {
				"time": 1719477075, // 2024-06-27T10:31:15+02:00
				"delay": 195,
			},
		},
		// AUS IstFahrt contains no IstHalt for this Schedule stop_time
		{
			// todo: once Schedule data has stop/station topology, expect matching stop_sequence & stop_id here
			"stop_sequence": null,
			"stop_id": "900360218",
			"arrival": {
				"time": 1719476970,
				"delay": null,
			},
			"departure": {
				"time": 1719476970,
				"delay": null,
			},
		},
		// AUS IstFahrt contains no IstHalt for this Schedule stop_time
		{
			// todo: once Schedule data has stop/station topology, expect matching stop_sequence & stop_id here
			"stop_sequence": null,
			"stop_id": "900360036",
			"arrival": {
				"time": 1719477030,
				"delay": null,
			},
			"departure": {
				"time": 1719477030,
				"delay": null,
			},
		},
		// AUS IstFahrt contains no IstHalt for this Schedule stop_time
		{
			// todo: once Schedule data has stop/station topology, expect matching stop_sequence & stop_id here
			"stop_sequence": null,
			"stop_id": "900360112",
			"arrival": {
				"time": 1719477120,
				"delay": null,
			},
			"departure": {
				"time": 1719477120,
				"delay": null,
			},
		},
		// AUS IstFahrt contains no IstHalt for this Schedule stop_time
		{
			// todo: once Schedule data has stop/station topology, expect matching stop_sequence & stop_id here
			"stop_sequence": null,
			"stop_id": "900360116",
			"arrival": {
				"time": 1719477180,
				"delay": null,
			},
			"departure": {
				"time": 1719477180,
				"delay": null,
			},
		},
		// AUS IstFahrt contains no IstHalt for this Schedule stop_time
		{
			// todo: once Schedule data has stop/station topology, expect matching stop_sequence & stop_id here
			"stop_sequence": null,
			"stop_id": "900360037",
			"arrival": {
				"time": 1719477330,
				"delay": null,
			},
			"departure": {
				"time": 1719477330,
				"delay": null,
			},
		},
		{
			// todo: once Schedule data has stop/station topology, expect matching stop_sequence & stop_id here
			"stop_sequence": null,
			"stop_id": "900360000",
			"arrival": {
				"time": 1719477672, // 2024-06-27T10:41:12+02:00
				"delay": 252,
			},
			"departure": {
				"time": 1719477420,
				"delay": null, // not provided by AUS IstFahrt
			},
		},
	]
}

export default tripUpdate981
