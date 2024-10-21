-- todo: extract into standalone lib, or move into gtfs-via-postgres
CREATE MATERIALIZED VIEW station_weights AS
WITH route_type_weights AS (
	SELECT *
	FROM unnest(
		ARRAY[
			-- https://github.com/public-transport/gtfs-via-postgres/blob/5321ae0/lib/routes.js#L243-L253
			0 -- Tram, Streetcar, Light rail. Any light rail or street level system within a metropolitan area.
			, 1 -- Subway, Metro. Any underground rail system within a metropolitan area.
			, 2 -- Rail. Used for intercity or long-distance travel.
			, 3 -- Bus. Used for short- and long-distance bus routes.
			, 4 -- Ferry. Used for short- and long-distance boat service.
			, 5 -- Cable tram. Used for street-level rail cars where the cable runs beneath the vehicle, e.g., cable car in San Francisco.
			, 6 -- Aerial lift, suspended cable car (e.g., gondola lift, aerial tramway). Cable transport where cabins, cars, gondolas or open chairs are suspended by means of one or more cables.
			, 7 -- Funicular. Any rail system designed for steep inclines.
			, 11 -- Trolleybus. Electric buses that draw power from overhead wires using poles.
			, 12 -- Monorail. Railway in which the track consists of a single rail or a beam.

			-- selected from https://github.com/public-transport/gtfs-via-postgres/blob/5321ae0/lib/routes.js#L5-L82
			, 100 -- Railway Service
			, 200 -- Coach Service
			, 400 -- Urban Railway Service
			, 700 -- Bus Service
			, 900 -- Tram Service
			, 1000 -- Water Transport Service
		],
		ARRAY[
			.3 -- Tram, Streetcar, Light rail. Any light rail or street level system within a metropolitan area.
			, .5 -- Subway, Metro. Any underground rail system within a metropolitan area.
			, .8 -- Rail. Used for intercity or long-distance travel.
			, .25 -- Bus. Used for short- and long-distance bus routes.
			, .4 -- Ferry. Used for short- and long-distance boat service.
			, .3 -- Cable tram. Used for street-level rail cars where the cable runs beneath the vehicle, e.g., cable car in San Francisco.
			, .3 -- Aerial lift, suspended cable car (e.g., gondola lift, aerial tramway). Cable transport where cabins, cars, gondolas or open chairs are suspended by means of one or more cables.
			, .3 -- Funicular. Any rail system designed for steep inclines.
			, .25 -- Trolleybus. Electric buses that draw power from overhead wires using poles.
			, .5 -- Monorail. Railway in which the track consists of a single rail or a beam.

			, .8 -- Railway Service
			, .6 -- Coach Service
			, .5 -- Urban Railway Service
			, .25 -- Bus Service
			, .3 -- Tram Service
			, .4 -- Water Transport Service
		]
	) AS weights(route_type, weight)
)
SELECT
	station_id,
	-- ad.route_type, -- todo: remove
	round(sum(weight))::integer AS weight
FROM (
	SELECT
		-- todo: coalesce with default value?
		(route_type::text)::integer AS route_type,
		date,
		coalesce(station_id, array_to_string((string_to_array(stop_id, ':'))[1:3], ':')) AS station_id
	FROM arrivals_departures
) ad
LEFT JOIN route_type_weights rtw ON (
	(CASE WHEN ad.route_type = rtw.route_type
		THEN True
		ELSE (CASE WHEN ad.route_type >= 100
			THEN ad.route_type / 100
			ELSE ad.route_type
		END) = rtw.route_type
	END)
)
WHERE True
-- AND "date" = '2024-10-22'
-- AND weight IS NULL
-- AND station_id LIKE '%:900073281'
-- AND station_id LIKE 'de:11000:900%'
GROUP BY station_id;

CREATE INDEX station_weights_station_id ON station_weights (station_id);
