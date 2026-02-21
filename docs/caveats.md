## stop IDs

While matching `REF-AUS` `SollFahrt`s & `AUS` `IstFahrt`s to the GTFS Schedule data, the service assumes that the `HaltID`s (without the data-provider-specific prefixes) uniquely match a GTFS stop/station. As soon as there are >1 matching GTFS stops/stations, matching of a VDV *Fahrt* gets skipped.
