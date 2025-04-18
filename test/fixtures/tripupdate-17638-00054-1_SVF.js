const tripUpdate981 = {
	"trip": {
		"trip_id": "234717603",
		"route_id": "1871_700",
		"direction_id": 0,
		"start_date": "20240627",
		"schedule_relationship": 0,
	},
	"stop_time_update": [
		{
			"stop_sequence": 0,
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
			"stop_sequence": 1,
			"stop_id": "de:12053:900360135::2",
			"arrival": {
				"time": 1719476856,
				"delay": 36,
			},
			"departure": {
				"time": 1719476857,
				"delay": 37,
			},
		},

		// todo: AUS IstHalt uses HaltID `ODEG_122207` instead of `ODEG_900360222`
		{
			"stop_sequence": 2,
			"stop_id": "de:12053:900360222::1",
			"arrival": {
				"time": 1719476880, // 2024-06-27T10:28:00+02:00
				"delay": null,
			},
			"departure": {
				"time": 1719476880, // 2024-06-27T10:28:00+02:00
				"delay": null,
			},
		},
		{
			// "stop_sequence": null,
			"stop_id": "122207",
			"arrival": {
				"time": 1719476972, // 2024-06-27T10:29:32+02:00
				"delay": 92,
			},
			"departure": {
				"time": 1719476972, // 2024-06-27T10:29:32+02:00
				"delay": 92,
			},
		},

		{
			"stop_sequence": 3,
			"stop_id": "de:12053:900360022::1",
			"arrival": {
				"time": 1719477075, // 2024-06-27T10:31:15+02:00
				"delay": 165,
			},
			"departure": {
				"time": 1719477075, // 2024-06-27T10:31:15+02:00
				"delay": 165,
			},
		},
		// AUS IstFahrt contains no IstHalt for this Schedule stop_time
		{
			"stop_sequence": 4,
			"stop_id": "de:12053:900360218::1",
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
			"stop_sequence": 5,
			"stop_id": "de:12053:900360036::1",
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
			"stop_sequence": 6,
			"stop_id": "de:12053:900360112::1",
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
			"stop_sequence": 7,
			"stop_id": "de:12053:900360116::1",
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
			"stop_sequence": 8,
			"stop_id": "de:12053:900360037::1",
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
			"stop_sequence": 9,
			"stop_id": "de:12053:900360000::5",
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
