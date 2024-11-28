-- todo: move this into Mobidata-BW/postgis-gtfs-importer?

-- Generate access/index statistics by running some matching queries.
DO $do$
DECLARE
	_query TEXT;
	_t0 DOUBLE PRECISION;
	_seconds_passed DOUBLE PRECISION;
BEGIN
	-- Note: This query is just copied from lib/match-with-schedule-trip.js, inlined with some values. It will likely not yield results anymore soon because it uses old dates & times.
	_query = '
WITH
	st0 AS NOT MATERIALIZED (
		SELECT
			trip_id,
			"date",
			stop_sequence_consec
		FROM arrivals_departures ad
		WHERE True
		AND route_short_name = ''M43''

		AND (
			stop_id = ''900079152''
			OR station_id = ''900079152''
			OR station_id LIKE ''%:900079152''
			OR stop_id LIKE ''%:900079152%''
		)
		AND t_departure >= ''2024-11-27T15:28:00+01:00''
		AND t_departure <= ''2024-11-27T15:30:00+01:00''
		AND "date" >= dates_filter_min(''2024-11-27T15:28:00+01:00''::timestamp with time zone)
		AND "date" <= dates_filter_max(''2024-11-27T15:30:00+01:00''::timestamp with time zone)
	)
	, st1 AS NOT MATERIALIZED (
		SELECT
			trip_id,
			"date",
			stop_sequence_consec
		FROM arrivals_departures ad
		WHERE True
		AND route_short_name = ''M43''

		AND (
			stop_id = ''900079101''
			OR station_id = ''900079101''
			OR station_id LIKE ''%:900079101''
			OR stop_id LIKE ''%:900079101%''
		)
		AND t_departure >= ''2024-11-27T15:29:00+01:00''
		AND t_departure <= ''2024-11-27T15:31:00+01:00''
		AND "date" >= dates_filter_min(''2024-11-27T15:29:00+01:00''::timestamp with time zone)
		AND "date" <= dates_filter_max(''2024-11-27T15:31:00+01:00''::timestamp with time zone)
	)
	, matches AS NOT MATERIALIZED (
		SELECT DISTINCT ON (st0.trip_id, st0.date)
			st0.trip_id,
			st0."date"
		FROM st0
		INNER JOIN st1 ON (
			st1.trip_id = st0.trip_id
			AND st1.date = st0.date
			AND st1.stop_sequence_consec > st0.stop_sequence_consec
		)
		LIMIT 2
	)
SELECT
	ad.trip_id, (ad.date::date)::text AS "date",
	stop_sequence, stop_id
FROM arrivals_departures ad
WHERE True
AND ad.trip_id = ANY(array(SELECT trip_id FROM matches))
AND ad.date = ANY(array(SELECT "date" FROM matches))
AND (ad.trip_id, ad.date) IN (
	SELECT *
	FROM unnest(
		array(SELECT trip_id FROM matches),
		array(SELECT "date" FROM matches)
	) AS t(trip_id, "date")
)
ORDER BY trip_id, "date", stop_sequence_consec';

	_t0 = extract(epoch from clock_timestamp());
	RAISE NOTICE 'generating statistics by running <=100 matching queries for <=30s';
	FOR i IN 1..100 LOOP
		EXECUTE _query;

		_seconds_passed = extract(epoch from clock_timestamp()) - _t0;
		if _seconds_passed >= 30 THEN
			EXIT;
		END IF;
	END LOOP;
END
$do$
LANGUAGE plpgsql;

-- Analyze generated statistics, in order to guide PostgreSQL to use indices whenever it's worth it.
ANALYZE;
