# VBB GTFS-RT service

**Fetches realtime transit data from [VBB](https://en.wikipedia.org/wiki/Verkehrsverbund_Berlin-Brandenburg)'s [VDV-454 API](https://www.vdv.de/i-d-s-downloads.aspx), matches it against [GTFS Schedule](https://gtfs.org/schedule/) data, and serves it as [GTFS Realtime (GTFS-RT)](https://gtfs.org/realtime/) via HTTP.**

![ISC-licensed](https://img.shields.io/github/license/OpenDataVBB/gtfs-rt-feed.svg)

> [!TIP]
> Although `gtfs-rt-feed` can be used standalone, it is intended to be used in tandem with [`vdv-453-nats-adapter`](https://github.com/OpenDataVBB/vdv-453-nats-adapter) – which pulls the input VDV-454 data from a VDV-453/-454 API – and [`nats-consuming-gtfs-rt-server`](https://github.com/OpenDataVBB/nats-consuming-gtfs-rt-server) – which combines the `DIFFERENTIAL`-mode GTFS-RT data sent by `gtfs-rt-feed` into a single non-differential feed and serves it via HTTP.
> For more details about the architecture `gtfs-rt-feed` has been designed for, refer to the [VBB deployment's readme](https://github.com/OpenDataVBB/gtfs-rt-infrastructure/blob/main/readme.md).

It uses the [PostGIS GTFS importer](https://github.com/mobidata-bw/postgis-gtfs-importer) to import the GTFS Schedule data into a new PostgreSQL database whenever it has changed.


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
