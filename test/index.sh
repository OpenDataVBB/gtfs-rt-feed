#!/bin/bash

set -eu -o pipefail
cd $(dirname $(realpath $0))

set -x

node vdv-aus-istfahrt-as-fptf-trip.js
node fptf-trip-as-gtfs-rt-tripupdate.js
