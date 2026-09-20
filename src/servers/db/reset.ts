import 'dotenv/config'
import { db } from './index'
import { quests, users } from './schema'

async function reset() {
  await db.delete(quests)

  await db
    .update(users)
    .set({
      stars: 0,
    })

  console.log('Reset success')
  process.exit(0)
}

reset().catch((error) => {
  console.error(error)
  process.exit(1)
})