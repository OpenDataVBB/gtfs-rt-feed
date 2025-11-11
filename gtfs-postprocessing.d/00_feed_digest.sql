-- todo [breaking]: use PostgreSQL 15+ `getenv`

-- \set _schema public
-- \getenv _schema GTFS_IMPORTER_SCHEMA
-- `echo -n` is POSIX, but macOS' built-in sh is too old to support it. 🙄
\set _schema `set -u; echo "\"${GTFS_IMPORTER_SCHEMA:=public}\""`

-- \set feed_digest NULL
-- \getenv feed_digest GTFS_FEED_DIGEST
-- `echo -n` is POSIX, but macOS' built-in sh is too old to support it. 🙄
\set feed_digest `set -u; echo "'$GTFS_FEED_DIGEST'"`

-- note: this should be idempotent
DROP TABLE IF EXISTS :_schema._feed_digest;
CREATE TABLE :_schema._feed_digest (feed_digest TEXT);
TRUNCATE TABLE :_schema._feed_digest;
INSERT INTO :_schema._feed_digest (feed_digest) VALUES (
	regexp_replace(:feed_digest, '[\n\r]+', '')
);
