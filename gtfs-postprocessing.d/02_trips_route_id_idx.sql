-- todo: do this in gtfs-via-postgres, eventually get rid of it here
CREATE INDEX trips_route_id_idx ON trips (route_id);
