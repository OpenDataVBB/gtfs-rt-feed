#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"
set -x

node vdv-merging.js

export MATCH_GTFS_RT_TO_GTFS_CACHING=false

# ---

# VBB 2024-06-21 test

psql -c 'CREATE DATABASE test_vbb_2024'
export PGDATABASE=test_vbb_2024
env \
	GTFS_TMP_DIR="$PWD/gtfs" \
	GTFS_DOWNLOAD_URL='https://vbb-gtfs.jannisr.de/2024-06-21.gtfs.zip' \
	GTFS_IMPORTER_SCHEMA=public \
	GTFS_IMPORTER_DB_PREFIX=vbb_2024 \
	../import.sh

env PGDATABASE="$(psql -q --csv -t -c 'SELECT db_name FROM latest_successful_imports')" \
	node matching-vbb-2024.js

# ---

# VBB 2026-06-03 (filtered to only one M5 trip) test

psql -c 'CREATE DATABASE test_vbb_m5'
export PGDATABASE=test_vbb_m5
env \
	GTFS_TMP_DIR="$PWD/gtfs" \
	GTFS_DOWNLOAD_URL="file://$PWD/fixtures/vbb-m5-2026-06-03.gtfs.zip" \
	GTFS_IMPORTER_SCHEMA=public \
	GTFS_IMPORTER_DB_PREFIX=vbb_m5 \
	../import.sh

env PGDATABASE="$(psql -q --csv -t -c 'SELECT db_name FROM latest_successful_imports')" \
	node matching-vbb-m5.js
