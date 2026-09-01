## stop IDs

While matching VDV `REF-AUS` `SollFahrt`s & `AUS` `IstFahrt`s (short: VDV Fahrts) to the GTFS Schedule trip "instances", their `SollHalt`s/`IstHalt`s' `HaltID`s *must* match a GTFS stop/station *uniquely*.

But a VDV `HaltID` and a GTFS Schedule stop/station ID don't need be exactly equal to match, as outlined below, as differentiated by the step in the matching process.

> [!IMPORTANT]
> `HaltID`s may also have a data-source-specific prefix, which will be stripped before matching (see [`vdv-aus-istfahrt-as-gtfs-rt-tripupdate.js`](../lib/vdv-aus-istfahrt-as-gtfs-rt-tripupdate.js)).

### matching of a VDV Fahrt with Schedule trip "instance"

While finding a match for the entire VDV `SollFahrt`/`IstFahrt`, the `HaltID`
1. must either be exactly equal to the Schedule stop/station, no matter which format the latter has; or
2. it may be just
	- the 3rd and *last* segment of the [IFOPT](https://en.wikipedia.org/wiki/Identification_of_Fixed_Objects_in_Public_Transport)-style Schedule station ID, or
	- the 3rd segment (out of >=3) of the [IFOPT](https://en.wikipedia.org/wiki/Identification_of_Fixed_Objects_in_Public_Transport)-style Schedule stop ID.

Details can be found in `buildFindScheduleStopTimesQuery()` in [`query-schedule-stop-times.js`](lib/query-schedule-stop-times.js).

### matching of a VDV Halt with Schedule `stop_times` entry

Once a matching Schedule trip "instance" has been found for the VDV Fahrt, all `REF-AUS` `SollHalt`s & `AUS` `IstHalt`s (short: VDV Halts) will be matched against the Schedule trip "instance's" `stop_times` entries (short: Schedule stop-times).

For a VDV Halt to match a Schedule stop-time, the `HaltID`
1. must either be exactly equal to the Schedule stop-time's stop ID or station ID; or
2. it may be just the 3rd segment (out of >=3) of the [IFOPT](https://en.wikipedia.org/wiki/Identification_of_Fixed_Objects_in_Public_Transport)-style Schedule stop ID; or
3. vice versa

Details can be found in `stusHaveSameIfoptStationId()` in [`match-with-schedule-trip.js`](lib/match-with-schedule-trip.js).

### sitation with [VBB](https://en.wikipedia.org/wiki/Verkehrsverbund_Berlin-Brandenburg) data

As of 2026-09-01, because the GTFS Schedule *mostly* uses [IFOPT](https://en.wikipedia.org/wiki/Identification_of_Fixed_Objects_in_Public_Transport)-style stop & station ID while the VDV data uses mostly "plain" `HaltID`s, "fuzzy" matching (variants 2/3 above) is necessary to get a decent realtime coverage.

The following bug reports are related to this problem:
- [gtfs-rt-infrastructure#8](https://github.com/OpenDataVBB/gtfs-rt-infrastructure/issues/8) – bug report about stops skipped in the RT data, due to stop ID mismatches
	- [transitous#2463](https://github.com/public-transport/transitous/issues/2463) – another similar report in the Transitous Issue tracker
- [GTFS-Issues#312](https://github.com/mfdz/GTFS-Issues/issues/312) – long-term Issue to track VBB's consistency in using IFOPT-style IDs in Schedule data
