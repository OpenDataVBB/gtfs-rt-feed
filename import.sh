#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"

export GTFS_DOWNLOAD_USER_AGENT="${GTFS_DOWNLOAD_USER_AGENT:-OpenDataVBB/gtfs-rt-feed GTFS import}"
export GTFS_DOWNLOAD_URL="${GTFS_DOWNLOAD_URL:-https://www.vbb.de/vbbgtfs}"
export GTFS_IMPORTER_DB_PREFIX="${GTFS_IMPORTER_DB_PREFIX:-gtfs}"
export GTFS_TMP_DIR="${GTFS_TMP_DIR:-"$PWD/gtfs"}"
export GTFS_POSTPROCESSING_D_PATH="${GTFS_POSTPROCESSING_D_PATH:-"$PWD/gtfs-postprocessing.d"}"
# The VBB GTFS feed usually doesn't need gtfstidy-ing.
export GTFSTIDY_BEFORE_IMPORT="${GTFSTIDY_BEFORE_IMPORT:-false}"

# if stdin is not a TTY, don't pass `-it`
docker_run_args=()
if [ -t 1 ]; then
	docker_run_args+=('-it')
fi

set -x

if [ "${1:-}" = '--docker' ]; then
	# run PostGIS GTFS importer using Docker
	# todo: remove --platform
	docker run --rm "${docker_run_args[@]}" \
		--platform linux/amd64 \
		--network host \
		-v $PWD/gtfs:/tmp/gtfs \
		-v "$GTFS_POSTPROCESSING_D_PATH":/etc/gtfs-postprocessing.d \
		-e GTFS_DOWNLOAD_USER_AGENT \
		-e GTFS_DOWNLOAD_URL \
		-e GTFS_IMPORTER_DB_PREFIX \
		-e GTFS_TMP_DIR \
		-e GTFSTIDY_BEFORE_IMPORT  \
		-e GTFS_POSTPROCESSING_D_PATH=/etc/gtfs-postprocessing.d \
		-e PGHOST=localhost -e PGUSER -e PGPASSWORD -e PGDATABASE \
		ghcr.io/mobidata-bw/postgis-gtfs-importer:v4
else
	# run PostGIS GTFS importer locally
	./postgis-gtfs-importer/importer.js
fi
