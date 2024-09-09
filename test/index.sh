#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"
set -x

wget -nv --compression auto \
	-r --no-parent --no-directories -R .csv.gz,.csv.br,shapes.csv \
	-P gtfs -N 'https://vbb-gtfs.jannisr.de/2024-06-21/'

env | grep '^PG' || true
psql -c 'CREATE DATABASE vbb_2024_06_21'
export PGDATABASE=vbb_2024_06_21

NODE_ENV=production gtfs-to-sql -d \
	--trips-without-shape-id -- \
	gtfs/agency.csv \
	gtfs/calendar.csv \
	gtfs/calendar_dates.csv \
	gtfs/frequencies.csv \
	gtfs/routes.csv \
	gtfs/stop_times.csv \
	gtfs/stops.csv \
	gtfs/transfers.csv \
	gtfs/trips.csv \
	| sponge | psql -q -b -v 'ON_ERROR_STOP=1'

NODE_ENV=production build-gtfs-match-index \
	../hafas-info.js ../gtfs-info.js \
	| sponge | psql -q -b -v 'ON_ERROR_STOP=1'

# ---

env MATCH_GTFS_RT_TO_GTFS_CACHING=false node matching.js
