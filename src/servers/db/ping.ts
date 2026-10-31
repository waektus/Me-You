import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db, pool } from './index'

async function ping() {
  const result = await db.execute(sql`select current_database() as db, now() as now`)

  console.log('Database connected:', result.rows[0])
  await pool.end()
}

ping().catch(async (error) => {
  console.error('Database connection failed:', error.message)
  await pool.end()
  process.exit(1)
})
