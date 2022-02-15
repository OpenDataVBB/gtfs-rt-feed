#!/bin/bash

set -e
set -o pipefail
set -x

wget -c --compression auto -O gtfs.zip -N 'https://gtfs.mfdz.de/DELFI.BB.gtfs.zip'
unzip -o -d gtfs -j gtfs.zip

env | grep '^PG'

NODE_ENV=production node_modules/.bin/gtfs-to-sql -d --trips-without-shape-id --routes-without-agency-id -- \
	gtfs/agency.txt \
	gtfs/calendar.txt \
	gtfs/calendar_dates.txt \
	gtfs/routes.txt \
	gtfs/shapes.txt \
	gtfs/stop_times.txt \
	gtfs/stops.txt \
	gtfs/trips.txt \
	| psql -b
	# gtfs/frequencies.txt \
	# gtfs/transfers.txt \

lib="$(dirname $(realpath $0))/lib"
NODE_ENV=production node_modules/.bin/build-gtfs-match-index \
	$lib/hafas-info.js $lib/gtfs-info.js \
	| psql -b
