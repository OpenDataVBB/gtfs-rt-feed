# VBB GTFS-RT service

**Fetches realtime transit data from [VBB](https://en.wikipedia.org/wiki/Verkehrsverbund_Berlin-Brandenburg)'s [VDV-454 API](https://www.vdv.de/i-d-s-downloads.aspx), matches it against [GTFS Schedule](https://gtfs.org/schedule/) data, and serves it as [GTFS Realtime (GTFS-RT)](https://gtfs.org/realtime/) via HTTP.**

![ISC-licensed](https://img.shields.io/github/license/OpenDataVBB/gtfs-rt-feed.svg)

It uses the [PostGIS GTFS importer](https://github.com/mobidata-bw/postgis-gtfs-importer) to import the GTFS Schedule data into a new PostgreSQL database whenever it has changed.


## Installation

todo


## Getting Started

todo

### via docker-compose

The example [`docker-compose.yml`](docker-compose.yml) starts up a complete set of containers (`vbb-gtfs-rt-server` and all of its dependencies: PostgreSQL & NATS).

Be sure to set `POSTGRES_PASSWORD`, either via a `.env` file or an environment variable.

```sh
POSTGRES_PASSWORD=my_secret_password docker-compose up
```


## License

This project is [ISC-licensed](license.md).

Note that [PostGIS GTFS importer](https://github.com/mobidata-bw/postgis-gtfs-importer), one of the service's dependencies, is EUPL-licensed.
