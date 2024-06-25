#!/bin/bash

set -eu -o pipefail
cd "$(dirname "$(dirname $0)")"
set -x

# `build-gtfs-match-index` is provided by an npm package, so its executable is symlinked into `node_modules/.bin`.
build-gtfs-match-index \
	lib/rt-info.js \
	lib/gtfs-info.js \
	| sponge | psql -b -1 -v 'ON_ERROR_STOP=1'
