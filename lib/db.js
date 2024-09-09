import {strictEqual} from 'node:assert/strict'
import _pg from 'pg'
const {Pool} = _pg

const DEFAULT_POOL_SIZE = parseInt(process.env.PG_POOL_SIZE || '30')

// > If pattern does not contain percent signs or underscore, then the pattern only represents the string itself; in that case LIKE acts like the equals operator. An underscore (_) in pattern stands for (matches) any single character; a percent sign (%) matches any string of zero or more characters.
// > To match a literal underscore or percent sign without matching other characters, the respective character in pattern must be preceded by the escape character. […]
// > https://www.postgresql.org/docs/7.3/functions-matching.html
const escapeForLikeOp = (input) => {
	return input
	.replaceAll('\\', '\\\\')
	.replaceAll('%', '\\%')
	.replaceAll('_', '\\_')
}
strictEqual(
	escapeForLikeOp('foo\\bar\\\\baz%hey_there'),
	'foo\\\\bar\\\\\\\\baz\\%hey\\_there',
)

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
	escapeForLikeOp,
	connectToPostgres,
}
