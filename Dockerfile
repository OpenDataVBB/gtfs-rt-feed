# syntax=docker/dockerfile:1.8
# ^ needed for ADD --checksum=…

FROM node:22-alpine
WORKDIR /app

LABEL org.opencontainers.image.title="vbb-gtfs-rt-service"
LABEL org.opencontainers.image.description="Matches realtime VDV-454 transit data against GTFS Schedule and serves it as GTFS Realtime."
LABEL org.opencontainers.image.authors="Verkehrsverbund Berlin Brandenburg <info@vbb.de>"

# install dependencies
ADD package.json /app
RUN npm install --production

# install tools
# - bash, ncurses (tput), moreutils (sponge), postgresql-client (psql), unzip & zstd are required by postgis-gtfs-importer.
# - curl is required by curl-mirror, which is required by postgis-gtfs-importer.
RUN apk add --update --no-cache \
	bash \
	curl \
	ncurses \
	moreutils \
	postgresql-client \
	unzip \
	zstd
# install curl-mirror
RUN curl -fsSL \
	'https://gist.github.com/derhuerst/745cf09fe5f3ea2569948dd215bbfe1a/raw/9d145086ba239f05b20b6b984fa49563bd781194/mirror.mjs' \
	-H 'User-Agent: OpenDataVBB/gtfs-rt-feed Docker build' \
	-o /usr/local/bin/curl-mirror \
	&& chmod +x /usr/local/bin/curl-mirror \
	&& curl-mirror --help >/dev/null

# install PostGIS GTFS importer
ADD postgis-gtfs-importer /app/postgis-gtfs-importer
RUN \
	cd postgis-gtfs-importer \
	&& npm install --production \
	&& npm cache clean --force

# add source code
ADD . /app

CMD [ "node", "index.js"]
