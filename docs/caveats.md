## stop IDs

While matching `AUS` `IstFahrt`s to the GTFS Schedule data, the services assumes that the `HaltID`s (without the data-provider-specific prefixes) uniquely match a GTFS stop/station. As soon as there are >1 matching GTFS stops/stations, matching of the `AusFahrt` gets skipped.
