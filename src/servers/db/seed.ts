import 'dotenv/config'
import { db } from './index'
import { users } from './schema'

async function seed() {
  await db.insert(users).values([
    {
      name: 'แพลงก์ตอน',
      stars: 0,
    },
    {
      name: 'มิลิน',
      stars: 0,
    },
  ])
  process.exit(0)
}

seed().catch((error) => {
  console.error(error)
  process.exit(1)
})