import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing')
}

// Supabase pooler requires SSL; local Postgres usually does not
const isSupabase = databaseUrl.includes('supabase.com')

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
})

export const db = drizzle({ client: pool })
