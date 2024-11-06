# VBB GTFS-RT service

Continuously **matches realtime transit data in the [VDV-454 structure](https://www.vdv.de/i-d-s-downloads.aspx) against a [GTFS Schedule](https://gtfs.org/schedule/) dataset and generates [GTFS Realtime (GTFS-RT)](https://gtfs.org/realtime/) data**.

![ISC-licensed](https://img.shields.io/github/license/OpenDataVBB/gtfs-rt-feed.svg)

> [!TIP]
> Although `gtfs-rt-feed` can be used standalone, it is intended to be used in tandem with [`vdv-453-nats-adapter`](https://github.com/OpenDataVBB/vdv-453-nats-adapter) – which pulls the input VDV-454 data from a VDV-453/-454 API – and [`nats-consuming-gtfs-rt-server`](https://github.com/OpenDataVBB/nats-consuming-gtfs-rt-server) – which combines the `DIFFERENTIAL`-mode GTFS-RT data sent by `gtfs-rt-feed` into a single non-differential feed and serves it via HTTP.
> For more details about the architecture `gtfs-rt-feed` has been designed for, refer to the [VBB deployment's readme](https://github.com/OpenDataVBB/gtfs-rt-infrastructure/blob/main/readme.md).

It uses the [PostGIS GTFS importer](https://github.com/mobidata-bw/postgis-gtfs-importer) to import the GTFS Schedule data into a new PostgreSQL database whenever it has changed.


## How *matching* works

This service reads VDV-454 `IstFahrt`s (in JSON instead of XML) from a [NATS message queue](https://docs.nats.io/):

```json5
// To be more readable, this example only contains essential fields. In practice, there are more.
{
	"LinienID": "M77",
	"LinienText": "M77",
	"FahrtID": {
		"FahrtBezeichner": "9325_877_8_2_19_1_1806#BVG",
		"Betriebstag": "2024-09-20",
	},
	"IstHalts": [
		{
			"HaltID": "900073281",
			"Abfahrtszeit": "2024-09-20T12:41:00Z",
			"IstAbfahrtPrognose": "2024-09-20T13:47:00+01:00", // 6 minutes delay
		},
		{
			"HaltID": "900073236",
			"Ankunftszeit": "2024-09-20T12:43:00Z",
			"Abfahrtszeit": "2024-09-20T12:45:00Z",
			"IstAnkunftPrognose": "2024-09-20T13:46:00+01:00", // 3 minutes delay
			"IstAbfahrtPrognose": "2024-09-20T13:47:00+01:00", // 2 minutes delay
		},
		// Usually there are more IstHalts, but the IstFahrt may not be complete.
	],
}
```

First, it is transformed it into a GTFS-RT `TripUpdate`, so that subsequent must only deal with GTFS-RT concepts.

```js
// Again, this example has been shortened for readability.
{
	"trip": {},
	"stop_time_update": [
		{
			"stop_id": "900073281",
			"departure": {
				"time": 1726836420,
				"delay": 300,
			},
		},
		{
			"stop_id": "900073236",
			"arrival": {
				"time": 1726836360,
				"delay": 180,
			},
			"departure": {
				"time": 1726836420,
				"delay": 120,
			},
		},
	],
	// not part of the GTFS Realtime spec, we just use it for matching and/or debug-logging
	[kRouteShortName]: "M77",
}
```

Within the imported GTFS Schedule data, `gtfs-rt-feed` then tries to find trip "instances" that
- have the same `route_short_name` ("M77"),
- for at least two `IstHalts`, stop at (roughly) the same scheduled time (`2024-09-20T12:41:00Z`) at (roughly) the same stop (`900073281`).

If there is **exactly one such GTFS Schedule trip "instance", we call it a *match***. If there are 2 trip "instances", we consider the the match *ambiguous* and not specific enough, so we stop processing the `IstFahrt`.

The GTFS Schedule trip "instance" is then formatted as a GTFS-RT `TripUpdate` (it contains no realtime data). Then the schedule `TripUpdate` and the *matched* realtime `TripUpdate` get merged into a single new `TripUpdate`.

```js
// Again, this example has been shortened for readability.
{
	"trip": {
		"trip_id": "1234567",
		"route_id": "17462_700",
	},
	"stop_time_update": [
		{
			"stop_id": "de:11000:900073281",
			// Note that `arrival` has been filled in from schedule data.
			"arrival": {
				"time": 1726836060,
			},
			"departure": {
				"time": 1726836420,
				"delay": 300,
			},
		},
		{
			"stop_id": "de:11000:900073236",
			"arrival": {
				"time": 1726836360,
				"delay": 180,
			},
			"departure": {
				"time": 1726836420,
				"delay": 120,
			},
		},
	],
	// not part of the GTFS Realtime spec, we just use it for matching and/or debug-logging
	[kRouteShortName]: "M77",
}
```

This whole process, which we call *matching*, is done continuously for each VDV-454 `IstFahrt` received from NATS.


## Installation

todo


## Getting Started

> [!IMPORTANT]
> Although `gtfs-rt-feed` is intended to be data-source-agnostic, just following the GTFS Schedule and GTFS-RT specs, it currently has some hard-coded assumptions specific to the [VBB deployment](https://github.com/OpenDataVBB/gtfs-rt-infrastructure) it has been developed for. Please create an Issue if you want to use `gtfs-rt-feed` in another setting.

todo

### via docker-compose

The example [`docker-compose.yml`](docker-compose.yml) starts up a complete set of containers (`vbb-gtfs-rt-server` and all of its dependencies: PostgreSQL & NATS).

> [!WARNING]
> The Docker Compose setup is only intended as a quick demo on how to run `gtfs-rt-feed` and its dependency services.

Be sure to set `POSTGRES_PASSWORD`, either via a `.env` file or an environment variable.

```sh
POSTGRES_PASSWORD=my_secret_password docker-compose up
```


## License

This project is [ISC-licensed](license.md).

Note that [PostGIS GTFS importer](https://github.com/mobidata-bw/postgis-gtfs-importer), one of the service's dependencies, is EUPL-licensed.
