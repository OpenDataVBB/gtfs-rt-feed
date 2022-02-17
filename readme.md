# bbnavi-gtfs-rt-feed

**Polls the [VBB HAFAS endpoint](https://github.com/public-transport/vbb-hafas) to provide a [GTFS Realtime (GTFS-RT)](https://gtfs.org/reference/realtime/v2/) feed for bbnavi.** Fork of [`berlin-gtfs-rt-server`](https://github.com/derhuerst/berlin-gtfs-rt-server).

This project uses [`hafas-client`](https://github.com/public-transport/hafas-client) & [`hafas-gtfs-rt-feed`](https://github.com/derhuerst/hafas-gtfs-rt-feed) to fetch live data about all vehicles in the Berlin & Brandenburg area and build a live [GTFS Realtime (GTFS-RT)](https://developers.google.com/transit/gtfs-realtime/) feed from them.


## Installing & running

*Note*: [`hafas-gtfs-rt-feed`](https://github.com/derhuerst/hafas-gtfs-rt-feed), the library used by this project for convert for building the GTFS-RT feed, has more extensive docs. For brevity and to avoid duplication (with e.g. [`hamburg-gtfs-rt-server`](https://github.com/derhuerst/hamburg-gtfs-rt-server)), the following instructions just cover the basics.

### Prerequisites

`bbnavi-gtfs-rt-feed` needs access to a [Redis](https://redis.io/) server, you can configure a custom host/port by setting the `REDIS_URL` environment variable.

It also needs access to a [PostgreSQL](https://www.postgresql.org) 12+ server; Pass custom [`PG*` environment variables](https://www.postgresql.org/docs/12/libpq-envars.html) if you run PostgreSQL in an unusual configuration.

It also needs access to a [NATS Streaming](https://docs.nats.io/nats-streaming-concepts/intro) server (just follow its [setup guide](https://docs.nats.io/nats-streaming-server/run)); Set the `NATS_STREAMING_URL` environment variable if you run it in an unusual configuration.

```shell
git clone https://github.com/bbnavi/gtfs-rt-feed.git
cd bbnavi-gtfs-rt-feed
npm install --production
```

### Building the matching index

```shell
npm run build
```

The build script will download [the latest VBB GTFS Static data](https://vbb-gtfs.jannisr.de/latest/) and import it into PostgreSQL. Then, it will add [additional lookup tables to match realtime data with GTFS Static data](https://github.com/derhuerst/match-gtfs-rt-to-gtfs). [`psql`](https://www.postgresql.org/docs/current/app-psql.html) will need to have access to your database.

### Running

Specify the bounding box to be observed as JSON:

```shell
export BBOX='{"north": 52.52, "west": 13.36, "south": 52.5, "east": 13.39}'
```

In addition, you need to configure an access token in order to access the HAFAS API (you can obtain one at [VBB's API page](https://www.vbb.de/vbb-services/api-open-data/api/)):

```shell
export TOKEN='…'
```

`bbnavi-gtfs-rt-feed` uses `hafas-gtfs-rt-feed` underneath, which is split into three parts: polling the HAFAS endpoint (`monitor-hafas` CLI), matching realtime data (`match-with-gtf` CLI), and serving a GTFS-RT feed (`serve-as-gtfs-rt` CLI). You can run all three at once using the `start.sh` wrapper script:

```shell
./start.sh
```

In production, run all three using a tool that restarts them when they crash, e.g. [`systemctl`](https://www.digitalocean.com/community/tutorials/how-to-use-systemctl-to-manage-systemd-services-and-units), [`forever`](https://github.com/foreversd/forever#readme) or [Kubernetes](https://kubernetes.io).

### via Docker

You can build a Docker image:

```shell
docker build -t bbnavi/gtfs-rt-feed .
```

*Note:* The Docker image *does not* contain Redis, PostgreSQL & NATS. You need to configure access to them using the environment variables documented above (e.g. `NATS_STREAMING_URL`).

```shell
export BBOX='{"north": 52.52, "west": 13.36, "south": 52.5, "east": 13.39}'
# build the matching index
docker run -e BBOX -i -t --rm bbnavi/gtfs-rt-feed ./build.sh
# run
docker run -e BBOX -i -t --rm bbnavi/gtfs-rt-feed
```

### via docker-compose

The example [`docker-compose.yml`](docker-compose.yml) starts up a complete set of containers (`bbnavi-gtfs-rt-feed`, Redis, PostGIS/PostgreSQL, [NATS Streaming](https://docs.nats.io/nats-streaming-concepts/intro)) to generate a GTFS-RT feed

Be sure to set `POSTGRES_PASSWORD`, either via a `.env` file or an environment variable.

The environment may be started via

```sh
POSTGRES_PASSWORD=mySecretPassword docker-compose up -d
```

After starting, the GTFS-RT feed should be available via `http://localhost:3000/`.

### inspecting the feed

Check out [`hafas-gtfs-rt-feed`'s *inspecting the feed* section](https://github.com/derhuerst/hafas-gtfs-rt-feed/blob/master/readme.md#inspecting-the-feed).

### metrics

Check out [`hafas-gtfs-rt-feed`'s *metrics* section](https://github.com/derhuerst/hafas-gtfs-rt-feed/blob/master/readme.md#metrics).


## License

Refer to [`LICENSES/readme.md`](LICENSES/readme.md).
