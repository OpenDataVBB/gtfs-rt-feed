import _vbbProfile from 'hafas-client/p/vbb/index.js'
import defaultProfile from 'hafas-client/lib/default-profile.js'
import withThrottling from 'hafas-client/throttle.js'
import createHafas from 'hafas-client'
import Redis from 'ioredis'
import withCaching from 'cached-hafas-client'
import createRedisStore from 'cached-hafas-client/stores/redis.js'

const vbbProfile = {
	..._vbbProfile,
	// Force hafas-client *not to* normalize stop names, we do it ourselves.
	parseStationName: (ctx, name) => name,
	parseLocation: defaultProfile.parseLocation,
}
const rawHafas = createHafas(
	withThrottling(vbbProfile, 50, 1000), // 50 req/s
	'bbnavi-gtfs-rt-feed',
)

const redisOpts = {}
if (process.env.REDIS_URL) {
	const url = new URL(process.env.REDIS_URL)
	redisOpts.host = url.hostname || 'localhost'
	redisOpts.port = url.port || '6379'
	if (url.password) redisOpts.password = url.password
	if (url.pathname && url.pathname.length > 1) {
		redisOpts.db = parseInt(url.pathname.slice(1))
	}
}
const redis = new Redis(redisOpts)

const hafas = withCaching(rawHafas, createRedisStore(redis))

// todo: expose a way to close the Redis client
export default hafas
