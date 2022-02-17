#!/bin/bash

set -e
set -o pipefail

lib="$(dirname $(realpath $0))/lib"

# kill child processes on exit
# https://stackoverflow.com/questions/360201/how-do-i-kill-background-processes-jobs-when-my-shell-script-exits/2173421#2173421
trap 'exit_code=$?; kill -- $(jobs -p); exit $exit_code' SIGINT SIGTERM EXIT

HAFAS_MAX_RADAR_RESULTS=1000 node_modules/.bin/monitor-hafas \
	--movements-fetch-interval-fn $lib/movements-fetch-interval.js \
	--trips-fetch-mode on-demand \
	$lib/hafas.js \
	&

node_modules/.bin/match-with-gtfs \
	$lib/hafas-info.js $lib/gtfs-info.js \
	&

node_modules/.bin/serve-as-gtfs-rt \
	--signal-demand \
	--static-feed-url 'https://gtfs.mfdz.de/DELFI.BB.gtfs.zip' \
	&
  # --static-feed-info gtfs/feed_info.txt \

wait || exit 1 # fail if any child failed
