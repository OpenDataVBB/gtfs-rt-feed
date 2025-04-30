# gtfs-rt-feed

Continuously **matches realtime transit data in the [VDV-454 structure](https://www.vdv.de/i-d-s-downloads.aspx) against a [GTFS Schedule](https://gtfs.org/schedule/) dataset and generates [GTFS Realtime (GTFS-RT)](https://gtfs.org/realtime/) data**.

![ISC-licensed](https://img.shields.io/github/license/OpenDataVBB/gtfs-rt-feed.svg)

> [!TIP]
> If you're just looking for VBB's publicly deployed GTFS-RT feed:
> - [actual GTFS-RT feed](https://production.gtfsrt.vbb.de) ([staging](https://staging.gtfsrt.vbb.de))
> - [parsed in `gtfs-rt-inspector`](https://public-transport.github.io/gtfs-rt-inspector/?feedUrl=https%3A%2F%2Fproduction.gtfsrt.vbb.de%2Fdata&view=inspector) ([staging](https://public-transport.github.io/gtfs-rt-inspector/?feedUrl=https%3A%2F%2Fstaging.gtfsrt.vbb.de%2Fdata&view=inspector))

> [!TIP]
> Although `gtfs-rt-feed` can be used standalone, it is intended to be used in tandem with [`vdv-453-nats-adapter`](https://github.com/OpenDataVBB/vdv-453-nats-adapter) – which pulls the input VDV-454 data from a VDV-453/-454 API – and [`nats-consuming-gtfs-rt-server`](https://github.com/OpenDataVBB/nats-consuming-gtfs-rt-server) – which combines the `DIFFERENTIAL`-mode GTFS-RT data sent by `gtfs-rt-feed` into a single non-differential feed and serves it via HTTP.
>
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

First, it is transformed into a GTFS-RT `TripUpdate`, so that subsequent code must only deal with GTFS-RT concepts.

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

There is [a Docker image available](https://github.com/OpenDataVBB/pkgs/container/gtfs-rt-feed):

```shell
# pull the Docker image …
docker pull ghcr.io/opendatavbb/gtfs-rt-feed

# … or install everything manually (you will need Node.js & npm).
git clone https://github.com/OpenDataVBB/gtfs-rt-feed.git gtfs-rt-feed
cd gtfs-rt-feed
npm install --omit dev
# install submodules' dependencies
git submodule update --checkout
cd postgis-gtfs-importer && npm install --omit dev
```


## Getting Started

> [!IMPORTANT]
> Although `gtfs-rt-feed` is intended to be data-source-agnostic, just following the GTFS Schedule and GTFS-RT specs, it currently has some hard-coded assumptions specific to the [VBB deployment](https://github.com/OpenDataVBB/gtfs-rt-infrastructure) it has been developed for. Please create an Issue if you want to use `gtfs-rt-feed` in another setting.

### Prerequisites

`gtfs-rt-feed` needs access to the following services to work:

- a [NATS message queue](https://docs.nats.io) with [JetStream](https://docs.nats.io/nats-concepts/jetstream) enabled
- a [PostgreSQL database server](https://postgresql.org), with the permission to dynamically create new databases (see [postgis-gtfs-importer](https://github.com/mobidata-bw/postgis-gtfs-importer)'s readme)
- a [Redis in-memory cache](https://redis.io/docs/latest/)

#### configure access to PostgreSQL

`gtfs-rt-feed` uses [`pg`](https://npmjs.com/package/pg) to connect to PostgreSQL; For details about supported environment variables and their defaults, refer to [`pg`'s docs](https://node-postgres.com).

To make sure that the connection works, use [`psql`](https://www.postgresql.org/docs/14/app-psql.html) from the same context (same permissions, same container if applicable, etc.).

#### configure access to NATS

`gtfs-rt-feed` uses [`nats`](https://npmjs.com/package/nats) to connect to NATS. You can use the following environment variables to configure access:
- `$NATS_SERVERS` – list of NATS servers (e.g. `localhost:4222`), separated by `,`
- `$NATS_USER` & `$NATS_PASSWORD` – if you need [authentication](https://docs.nats.io/using-nats/developer/connecting/userpass)
- `$NATS_CLIENT_NAME` – the [connection name](https://docs.nats.io/using-nats/developer/connecting/name)

By default, `gtfs-rt-feed` will connect as `gtfs-rt-$MAJOR_VERSION` to `localhost:4222` without authentication.

#### create NATS stream & consumer

We also need to create a [NATS JetStream](https://docs.nats.io/nats-concepts/jetstream) [stream](https://docs.nats.io/nats-concepts/jetstream/streams) called `AUS_ISTFAHRT_2` that `gtfs-rt-feed` will read (unmatched) VDV-454 `AUS` `IstFahrt` messages from. This can be done using the [NATS CLI](https://github.com/nats-io/natscli):

```shell
nats stream add \
	# omit this if you want to configure more details
	--defaults \
	# collect all messages published to these subjects
	--subjects='aus.istfahrt.>' \
	# acknowledge publishes
	--ack \
	# with limited storage, discard the oldest limits first
	--retention=limits --discard=old \
	--description='VDV-454 AUS IstFahrt messages' \
	# name of the stream
	AUS_ISTFAHRT_2
```

On the `AUS_ISTFAHRT_2` stream, we create a durable [consumer](https://docs.nats.io/nats-concepts/jetstream/consumers) called `gtfs-rt-feed`:

```shell
nats consumer add \
	# omit this if you want to configure more details
	--defaults \
	# create a pull-based consumer (refer to the NATS JetStream docs)
	--pull \
	# let gtfs-rt-feed explicitly acknowledge all received messages
	--ack=explicit \
	# let the newly created consumer start with the latest messages in AUS_ISTFAHRT_2 (not all)
	--deliver=new \
	# send gtfs-rt-feed at most 200 messages at once
	--max-pending=200 \
	# when & how often to re-deliver a message that hasn't been acknowledged (usually because it couldn't be processed)
	--max-deliver=3 \
	--backoff=linear \
	--backoff-steps=2 \
	--backoff-min=15s \
	--backoff-max=2m \
	--description 'OpenDataVBB/gtfs-rt-feed' \
	# name of the stream
	AUS_ISTFAHRT_2 \
	# name of the consumer
	gtfs-rt-feed
```

Next, again using the NATS CLI, we'll create a stream called `GTFS_RT_2` that the `gtfs-rt-feed` service will write (matched) GTFS-RT messages into:

```shell
nats stream add \
	# omit this if you want to configure more details
	--defaults \
	# collect all messages published to these subjects
	--subjects='gtfsrt.>' \
	# acknowledge publishes
	--ack \
	# with limited storage, discard the oldest limits first
	--retention=limits --discard=old \
	--description='GTFS-RT messages' \
	# name of the stream
	GTFS_RT_2
```

#### configure access to Redis

`gtfs-rt-feed` uses [`ioredis`](https://npmjs.com/package/ioredis) to connect to Redis; For details about supported environment variables and their defaults, refer to [its docs](https://github.com/redis/ioredis#readme).

> [!TIP]
> You should allow Redis to use at least a few hundred MB of memory. With the VBB deployment, we limit it to 2GB.

### import GTFS Schedule data

Make sure your GTFS Schedule dataset is available via HTTP without authentication. Configure the URL using `$GTFS_DOWNLOAD_URL`. Optionally, you can configure the `User-Agent` being used for downloading by setting `$GTFS_DOWNLOAD_USER_AGENT`.

The GTFS import script will
1. download the GTFS dataset;
1. import it into a separate database called `gtfs_$timestamp_$gtfs_hash` (each revision gets its own database);
2. keep track of the latest *successfully imported* database's name in a meta "bookkeeping" database (`$PGDATABASE` by default).

Refer to [postgis-gtfs-importer's docs](https://github.com/mobidata-bw/postgis-gtfs-importer#) for details about why this is done and how it works.

Optionally, you can
- activate [gtfstidy](https://github.com/patrickbr/gtfstidy)-ing before import using `GTFSTIDY_BEFORE_IMPORT=true`;
- postprocess the imported GTFS dataset using custom SQL scripts by putting them in `$PWD/gtfs-postprocessing.d`.

Refer to the [import script](import.sh) for details about how to customize the GTFS Schedule import.

```shell
export GTFS_DOWNLOAD_URL='…'
# Run import using Docker …
./import.sh --docker
# … or run import using ./postgis-gtfs-importer
./import.sh
```

Once the import has finished, you must set `$PGDATABASE` to the name of the newly created database.

```shell
export PGDATABASE="$(psql -q --csv -t -c 'SELECT db_name FROM latest_import')"
```

> [!NOTE]
> If you're running `gtfs-rt-feed` in a continuous (service-like) fashion, you'll want to run the GTFS Schedule import regularly, e.g. once per day. `postgis-gtfs-importer` won't import again if the dataset hasn't changed.
>
> Because it highly depends on your deployment strategy and preferences on how to schedule the import – and how to modify `$PGDATABASE` for the `gtfs-rt-feed` process afterwards –, this repo doesn't contain any tool for that.
>
> As an example, [VBB's deployment](https://github.com/OpenDataVBB/gtfs-rt-infrastructure) uses a [systemd timer](https://wiki.archlinux.org/title/Systemd/Timers) to schedule the import and a [systemd service drop-in file](https://unix.stackexchange.com/a/468067/593065) to set `$PGDATABASE`.

### run `gtfs-rt-feed`

```shell
# Run using Docker …
# (In production, use the container deployment tool of your choice.)
docker run --rm -it \
	-e PGDATABASE \
	# note: pass through other environment variables here
	ghcr.io/opendatavbb/gtfs-rt-feed

# … or manually.
# (During development, pipe the logs through `./node_modules/.bin/pino-pretty`.)
node index.js
```

todo: `$LOG_LEVEL`
todo: `$LOG_LEVEL_MATCHING`
todo: `$LOG_LEVEL_FORMATTING`
todo: `$LOG_LEVEL_STATION_WEIGHT`
todo: `$METRICS_SERVER_PORT`
todo: `$MATCHING_CONCURRENCY`
todo: `$MATCH_GTFS_RT_TO_GTFS_CACHING`
todo: `$MATCHING_CONSUMER_NAME`
todo: `$MATCHING_PUBLISH_UNMATCHED_TRIPUPDATES`
todo: `$PG_POOL_SIZE`

### Alternative: Docker Compose setup

The example [`docker-compose.yml`](docker-compose.yml) starts up a complete set of containers (`vbb-gtfs-rt-server` and all of its dependencies: PostgreSQL & NATS).

> [!WARNING]
> The Docker Compose setup is only intended as a quick demo on how to run `gtfs-rt-feed` and its dependency services.

Be sure to set `POSTGRES_PASSWORD`, either via a `.env` file or an environment variable.

```sh
POSTGRES_PASSWORD=my_secret_password docker-compose up
```


## Operating `gtfs-rt-feed`

### Logs

`gtfs-rt-feed` writes [pino-formatted](https://getpino.io/) log messages to `stdout`, so you can use [pino-compatible tools](https://getpino.io/#/docs/ecosystem) to process them.

### Monitoring

`gtfs-rt-feed` exposes [Prometheus](https://prometheus.io)-compatible metrics via HTTP. By default, the metrics server will listen on a random port. You can configure a permanent port using `$METRICS_SERVER_PORT`.

The following *kinds* of metrics will be exported:
- domain-specific metrics, e.g.
	- number of successful/failed/errored matchings
	- DB/cache query timings
- [technical details about the Node.js process](https://github.com/siimon/prom-client/blob/c1d76c5d497ef803f6bd90c56c713c3fa811c3e0/README.md#default-metrics), e.g. the current state of garbage collection

Refer to the [Grafana dashboard in VBB's deployment](https://github.com/OpenDataVBB/gtfs-rt-infrastructure/blob/cc920812506ae1b36962cd3453068ff199581392/lib/grafana/dashboards/gtfs-rt.json) for an example how to visualize `gtfs-rt-feed`'s metrics.


## License

This project is [ISC-licensed](license.md).

Note that [PostGIS GTFS importer](https://github.com/mobidata-bw/postgis-gtfs-importer), one of the service's dependencies, is EUPL-licensed.
