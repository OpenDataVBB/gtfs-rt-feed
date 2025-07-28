#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"
set -x

env \
	GTFS_TMP_DIR="$PWD/gtfs" \
	GTFS_DOWNLOAD_URL='https://vbb-gtfs.jannisr.de/2024-06-21.gtfs.zip' \
	GTFS_IMPORTER_SCHEMA=public \
	../import.sh

# ---

export PGDATABASE="$(psql -q --csv -t -c 'SELECT db_name FROM latest_successful_imports')"

node vdv-merging.js
env MATCH_GTFS_RT_TO_GTFS_CACHING=false node matching.js
