FROM node:alpine as builder
WORKDIR /app

# install dependencies
RUN apk add --update git bash
ADD package.json /app
RUN npm install

# build documentation
ADD . /app
RUN npm run docs

# ---

FROM node:alpine
LABEL org.opencontainers.image.title="bbnavi-gtfs-rt-feed"
LABEL org.opencontainers.image.description="Generates a GTFS Realtime feed by polling the VBB HAFAS API."
LABEL org.opencontainers.image.authors="Jannis R <mail@jannisr.de>"
LABEL org.opencontainers.image.documentation="https://github.com/bbnavi/gtfs-rt-feed"
LABEL org.opencontainers.image.source="https://github.com/bbnavi/gtfs-rt-feed"
LABEL org.opencontainers.image.revision="1"
WORKDIR /app

# install dependencies
RUN apk add --update bash wget postgresql-client
ADD package.json /app
RUN npm install --production && npm cache clean --force

# add source code
ADD . /app
COPY --from=builder /app/docs ./docs

EXPOSE 3000

ENV PORT 3000

CMD ["./start.sh"]
