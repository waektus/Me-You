import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './src/servers/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: (globalThis as typeof globalThis & {
      process: { env: { DATABASE_URL?: string } };
    }).process.env.DATABASE_URL!,
  },
});
