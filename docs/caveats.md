## stop IDs

While matching `AUS` `IstFahrt`s to the GTFS Schedule data, the services assumes that the `IstHalt.HaltID`s (without the data-provider-specific prefixes) match a GTFS stop/station unambigously, with some notable exceptions relaxing this requirement:

- The service assumes that every entry with a 3-section `$country:$region:$id`-formatted `stop_id` is a station.
- As long as there's only one station matching the `AUS` `HaltID`, regardless of the number of other stops/platforms matching too, it is considered an unambiguous match.
- Alternatively, as long as there are only stops/platforms (no station) "roughly" matching the `AUS` `HaltID`, the lexicographically first them is considered an unambiguous match.
- The `parent_station`-based topology delineated by GTFS Schedule is currently ignored.

Consider the following fictional GTFS Schedule `stops.txt`:

```csv
stop_id,stop_name,parent_station
de:12063:900210771,"Rathenow, Bahnhof",
de:12063:900210771::2,"Rathenow, Bahnhof",
de:12063:900210771::1,"Rathenow, Bahnhof",
de:12063:900210771:1:50,"Rathenow, Bahnhof",de:12063:900210771
de:12063:900210771:1:51,"Rathenow, Bahnhof",de:12063:900210771
de:12063:900210771:2:52,"Rathenow, Bahnhof",de:12063:900210771
de:12063:900210778::1,"Rathenow, Clara-Zetkin-Str.",
de:12063:900210779::1,"Rathenow, Curlandstr.",
de:12063:900210779::2,"Rathenow, Curlandstr.",
```

- The `AUS` `HaltID` of `ODEG_900210771` matches `de:12063:900210771`.
- The `AUS` `HaltID` of `ODEG_900210778` matches `de:12063:900210778::1`.
- The `AUS` `HaltID` of `ODEG_900210779` matches `de:12063:900210779::1`, because `de:12063:900210779::2` is also just a stop/platform.
- The `AUS` `HaltID` of `ODEG_90021077` doesn't match.

> [!IMPORTANT]
> The generated GTFS Realtime `StopTimeUpdate`s will be wrong in some cases, because their `stop_id` (e.g. `de:12063:900210779::1`) won't match the stop that the GTFS Schedule `trips.txt` specifies (e.g. `de:12063:900210779::2`)!
