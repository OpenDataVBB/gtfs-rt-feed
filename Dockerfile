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

# install PostGIS GTFS importer
RUN apk add --no-cache git
RUN git submodule update --remote postgis-gtfs-importer
RUN \
	cd postgis-gtfs-importer \
	&& npm install --production \
	&& npm cache clean --force

# add source code
ADD . /app

CMD [ "node", "index.js"]
