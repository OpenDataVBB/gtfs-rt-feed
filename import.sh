#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"

export GTFS_DOWNLOAD_USER_AGENT="${GTFS_DOWNLOAD_USER_AGENT:-OpenDataVBB/gtfs-rt-feed GTFS import}"
export GTFS_DOWNLOAD_URL="${GTFS_DOWNLOAD_URL:-https://www.vbb.de/vbbgtfs}"
export GTFS_IMPORTER_DB_PREFIX="${GTFS_IMPORTER_DB_PREFIX:-gtfs}"
export GTFS_TMP_DIR="${GTFS_TMP_DIR:-"$PWD/gtfs"}"
export GTFS_IMPORTER_SCHEMA=public
export GTFS_POSTPROCESSING_D_PATH="${GTFS_POSTPROCESSING_D_PATH:-"$PWD/gtfs-postprocessing.d"}"

set -x

if [ "${1:-}" = '--docker' ]; then
	# run PostGIS GTFS importer using Docker
	docker run --rm -it \
		-v $PWD/gtfs:/tmp/gtfs \
		-e "GTFS_DOWNLOAD_USER_AGENT=$GTFS_DOWNLOAD_USER_AGENT" \
		-e "GTFS_DOWNLOAD_URL=$GTFS_DOWNLOAD_URL" \
		-e "GTFS_IMPORTER_DB_PREFIX=$GTFS_IMPORTER_DB_PREFIX" \
		-e PGHOST=host.docker.internal -e PGUSER -e PGPASSWORD -e PGDATABASE \
		ghcr.io/mobidata-bw/postgis-gtfs-importer:v3
else
	# run PostGIS GTFS importer locally
	./postgis-gtfs-importer/importer.js
fi
