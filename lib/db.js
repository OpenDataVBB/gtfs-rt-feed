import _pg from 'pg'
const {Pool} = _pg

const DEFAULT_POOL_SIZE = parseInt(process.env.PG_POOL_SIZE || '30')

const connectToPostgres = async (opt = {}) => {
	// todo?
	// > Do not use pool.query if you need transactional integrity: the pool will dispatch every query passed to pool.query on the first available idle client. Transactions within PostgreSQL are scoped to a single client and so dispatching individual queries within a single transaction across multiple, random clients will cause big problems in your app and not work. For more info please read transactions.
	// https://node-postgres.com/api/pool
	const db = new Pool({
		// todo: let this depend on the configured matching parallelism
		max: DEFAULT_POOL_SIZE,
		...opt,
	})

	// todo: don't parse timestamptz into JS Date, keep ISO 8601 strings
	// todo: don't parse date into JS Date, keep ISO 8601 strings
	// https://github.com/brianc/node-pg-types

	const client = await db.connect()
	client.release()

	return db
}

export {
	connectToPostgres,
}
