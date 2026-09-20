import 'dotenv/config'

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import cors from 'cors'
import express from 'express'
import multer from 'multer'
import * as webpush from 'web-push'
import { and, desc, eq, gte, sql } from 'drizzle-orm'

import { db } from './db'
import { pushSubscriptions, quests, rewardRedemptions, users } from './db/schema'

const app = express()
const PORT = Number(process.env.PORT) || 3001

const FRONTEND_URLS = (process.env.FRONTEND_URL ?? 'http://localhost:5173')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean)

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? ''
const PUSH_ENABLED = Boolean(
  VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT,
)

if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  )
}

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, UPLOAD_DIR)
  },

  filename(_req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase() || '.jpg'
    callback(null, `${Date.now()}-${randomUUID()}${extension}`)
  },
})

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter(_req, file, callback) {
    if (!file.mimetype.startsWith('image/')) {
      callback(new Error('อนุญาตเฉพาะไฟล์รูปภาพ'))
      return
    }

    callback(null, true)
  },
})

function removeUploadedFile(file: Express.Multer.File | undefined) {
  if (!file) return
  fs.unlink(file.path, () => {})
}

app.use(
  cors({
    origin(origin, callback) {
      // Requests without an Origin header (for example curl/health checks) are allowed.
      if (!origin || FRONTEND_URLS.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error(`CORS blocked origin: ${origin}`))
    },
  }),
)
app.use(express.json())
app.use('/uploads', express.static(UPLOAD_DIR))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

type PushMessage = {
  title: string
  body: string
  url?: string
}

async function sendPushToUser(userId: number, message: PushMessage) {
  if (!PUSH_ENABLED) return

  try {
    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            JSON.stringify({
              title: message.title,
              body: message.body,
              url: message.url ?? '/',
            }),
          )
        } catch (error) {
          const statusCode =
            typeof error === 'object' &&
            error !== null &&
            'statusCode' in error
              ? Number((error as { statusCode?: number }).statusCode)
              : 0

          if (statusCode === 404 || statusCode === 410) {
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.endpoint, subscription.endpoint))
            return
          }

          console.error('push notification failed', error)
        }
      }),
    )
  } catch (error) {
    console.error('load push subscriptions failed', error)
  }
}

async function getUserName(userId: number) {
  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return user?.name ?? 'อีกฝ่าย'
}

app.post('/api/notifications/subscribe', async (req, res) => {
  try {
    const userId = Number(req.body.userId)
    const subscription = req.body.subscription
    const endpoint =
      typeof subscription?.endpoint === 'string' ? subscription.endpoint : ''
    const p256dh =
      typeof subscription?.keys?.p256dh === 'string'
        ? subscription.keys.p256dh
        : ''
    const auth =
      typeof subscription?.keys?.auth === 'string'
        ? subscription.keys.auth
        : ''

    if (!Number.isInteger(userId) || userId <= 0 || !endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'ข้อมูลการแจ้งเตือนไม่ครบ' })
    }

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!user) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    }

    const [saved] = await db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint,
        p256dh,
        auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId,
          p256dh,
          auth,
        },
      })
      .returning({ id: pushSubscriptions.id })

    return res.status(201).json({ ok: true, id: saved.id })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'เปิดการแจ้งเตือนไม่สำเร็จ' })
  }
})

app.get('/api/users', async (_req, res) => {
  try {
    const data = await db.select().from(users).orderBy(users.id)
    res.json(data)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'โหลด users ไม่สำเร็จ' })
  }
})

app.get('/api/quests', async (_req, res) => {
  try {
    const data = await db
      .select()
      .from(quests)
      .orderBy(desc(quests.createdAt))

    res.json(data)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'โหลด quests ไม่สำเร็จ' })
  }
})

const REWARD_COST = 30

app.get('/api/rewards', async (_req, res) => {
  try {
    const data = await db
      .select()
      .from(rewardRedemptions)
      .orderBy(desc(rewardRedemptions.createdAt))

    return res.json(data)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'โหลดประวัติรางวัลไม่สำเร็จ' })
  }
})

app.post('/api/rewards/redeem', async (req, res) => {
  try {
    const userId = Number(req.body.userId)
    const reward =
      typeof req.body.reward === 'string'
        ? req.body.reward.trim()
        : ''

    if (!Number.isInteger(userId) || userId <= 0 || !reward) {
      return res.status(400).json({ error: 'กรุณาระบุของรางวัล' })
    }

    if (reward.length > 200) {
      return res.status(400).json({ error: 'ของรางวัลต้องไม่เกิน 200 ตัวอักษร' })
    }

    const result = await db.transaction(async (tx) => {
      const [updatedUser] = await tx
        .update(users)
        .set({
          stars: sql`${users.stars} - ${REWARD_COST}`,
        })
        .where(
          and(
            eq(users.id, userId),
            gte(users.stars, REWARD_COST),
          ),
        )
        .returning()

      if (!updatedUser) {
        throw new Error('NOT_ENOUGH_STARS')
      }

      const [redemption] = await tx
        .insert(rewardRedemptions)
        .values({
          userId,
          reward,
          cost: REWARD_COST,
        })
        .returning()

      return {
        user: updatedUser,
        redemption,
      }
    })

    const redeemerName = await getUserName(userId)
    const allUsers = await db.select({ id: users.id }).from(users)

    for (const user of allUsers) {
      if (user.id !== userId) {
        void sendPushToUser(user.id, {
          title: 'มีการแลกรางวัล 🎁',
          body: `${redeemerName} แลกรางวัล “${reward}” แล้ว`,
          url: '/',
        })
      }
    }

    return res.status(201).json(result)
  } catch (error) {
    console.error(error)

    if (error instanceof Error && error.message === 'NOT_ENOUGH_STARS') {
      return res.status(400).json({ error: 'ต้องมีอย่างน้อย 30 ดาว' })
    }

    return res.status(500).json({ error: 'แลกรางวัลไม่สำเร็จ' })
  }
})

app.post('/api/quests', async (req, res) => {
  try {
    const {
      title,
      description,
      icon,
      questType,
      requirePhotoReason,
      due,
      points,
      verifyType,
      senderId,
      receiverId,
    } = req.body

    if (!title || !due || !senderId || !receiverId) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบ' })
    }

    if (verifyType !== 'review' && verifyType !== 'instant') {
      return res.status(400).json({ error: 'verifyType ไม่ถูกต้อง' })
    }

    const cleanQuestType = questType === 'photo' ? 'photo' : 'normal'
    const defaultIcon = cleanQuestType === 'photo' ? '📷' : '🎯'

    const cleanIcon =
      typeof icon === 'string' && icon.trim()
        ? icon.trim()
        : defaultIcon

    const [newQuest] = await db
      .insert(quests)
      .values({
        title: String(title).trim(),
        description:
          typeof description === 'string' && description.trim()
            ? description.trim()
            : null,
        icon: cleanIcon,
        questType: cleanQuestType,
        requirePhotoReason:
          cleanQuestType === 'photo' ? Boolean(requirePhotoReason) : false,
        due: String(due),
        points: Number(points) || 1,
        verifyType,
        status: 'pending',
        senderId: Number(senderId),
        receiverId: Number(receiverId),
      })
      .returning()

    const senderName = await getUserName(newQuest.senderId)
    void sendPushToUser(newQuest.receiverId, {
      title: 'มีเควสใหม่ 🎯',
      body: `${senderName} ส่งเควส “${newQuest.title}” ให้คุณ`,
      url: '/',
    })

    return res.status(201).json(newQuest)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'สร้าง Quest ไม่สำเร็จ' })
  }
})

app.patch('/api/quests/:id/complete', async (req, res) => {
  try {
    const questId = Number(req.params.id)

    if (Number.isNaN(questId)) {
      return res.status(400).json({ error: 'Quest ID ไม่ถูกต้อง' })
    }

    const [quest] = await db
      .select()
      .from(quests)
      .where(eq(quests.id, questId))
      .limit(1)

    if (!quest) {
      return res.status(404).json({ error: 'ไม่พบ Quest' })
    }

    if (quest.questType === 'photo') {
      return res.status(400).json({ error: 'Quest นี้ต้องส่งรูปภาพ' })
    }

    if (quest.status !== 'pending') {
      return res.status(409).json({ error: 'Quest นี้ถูกดำเนินการแล้ว' })
    }

    if (quest.verifyType === 'review') {
      const [updatedQuest] = await db
        .update(quests)
        .set({ status: 'review' })
        .where(
          and(
            eq(quests.id, questId),
            eq(quests.status, 'pending'),
          ),
        )
        .returning()

      if (!updatedQuest) {
        return res.status(409).json({ error: 'Quest นี้ถูกดำเนินการแล้ว' })
      }

      const receiverName = await getUserName(quest.receiverId)
      void sendPushToUser(quest.senderId, {
        title: 'มีเควสรอตรวจ ✅',
        body: `${receiverName} ทำ “${quest.title}” เสร็จแล้ว`,
        url: '/',
      })

      return res.json(updatedQuest)
    }

    const updatedQuest = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(quests)
        .set({ status: 'completed' })
        .where(
          and(
            eq(quests.id, questId),
            eq(quests.status, 'pending'),
          ),
        )
        .returning()

      if (!updated) {
        throw new Error('ALREADY_COMPLETED')
      }

      await tx
        .update(users)
        .set({
          stars: sql`${users.stars} + ${quest.points}`,
        })
        .where(eq(users.id, quest.receiverId))

      return updated
    })

    const receiverName = await getUserName(quest.receiverId)
    void sendPushToUser(quest.senderId, {
      title: 'เควสสำเร็จแล้ว ⭐',
      body: `${receiverName} ทำ “${quest.title}” สำเร็จแล้ว`,
      url: '/',
    })

    return res.json(updatedQuest)
  } catch (error) {
    console.error(error)

    if (error instanceof Error && error.message === 'ALREADY_COMPLETED') {
      return res.status(409).json({ error: 'Quest นี้ถูกดำเนินการแล้ว' })
    }

    return res.status(500).json({ error: 'ทำ Quest ไม่สำเร็จ' })
  }
})

app.post(
  '/api/quests/:id/photo',
  upload.single('photo'),
  async (req, res) => {
    try {
      const questId = Number(req.params.id)

      if (Number.isNaN(questId)) {
        removeUploadedFile(req.file)
        return res.status(400).json({ error: 'Quest ID ไม่ถูกต้อง' })
      }

      if (!req.file) {
        return res.status(400).json({ error: 'ไม่พบรูปภาพ' })
      }

      const [quest] = await db
        .select()
        .from(quests)
        .where(eq(quests.id, questId))
        .limit(1)

      if (!quest) {
        removeUploadedFile(req.file)
        return res.status(404).json({ error: 'ไม่พบ Quest' })
      }

      if (quest.questType !== 'photo') {
        removeUploadedFile(req.file)
        return res.status(400).json({ error: 'Quest นี้ไม่ใช่เควสถ่ายภาพ' })
      }

      if (quest.status !== 'pending') {
        removeUploadedFile(req.file)
        return res.status(409).json({ error: 'Quest นี้ส่งรูปแล้ว' })
      }

      const photoReason =
        typeof req.body.photoReason === 'string'
          ? req.body.photoReason.trim()
          : ''

      if (quest.requirePhotoReason && !photoReason) {
        removeUploadedFile(req.file)
        return res.status(400).json({
          error: 'เควสนี้ต้องอธิบายเหตุผลที่ถ่าย',
        })
      }

      if (photoReason.length > 300) {
        removeUploadedFile(req.file)
        return res.status(400).json({
          error: 'เหตุผลต้องไม่เกิน 300 ตัวอักษร',
        })
      }

      const photoUrl = `/uploads/${req.file.filename}`
      const submittedAt = new Date()

      if (quest.verifyType === 'review') {
        const [updatedQuest] = await db
          .update(quests)
          .set({
            photoUrl,
            photoReason: photoReason || null,
            photoSubmittedAt: submittedAt,
            status: 'review',
          })
          .where(
            and(
              eq(quests.id, questId),
              eq(quests.status, 'pending'),
            ),
          )
          .returning()

        if (!updatedQuest) {
          removeUploadedFile(req.file)
          return res.status(409).json({ error: 'Quest นี้ส่งรูปแล้ว' })
        }

        const receiverName = await getUserName(quest.receiverId)
        void sendPushToUser(quest.senderId, {
          title: 'มีรูปใหม่รอตรวจ 📷',
          body: `${receiverName} ส่งรูปสำหรับ “${quest.title}” แล้ว`,
          url: '/',
        })

        return res.json(updatedQuest)
      }

      const updatedQuest = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(quests)
          .set({
            photoUrl,
            photoReason: photoReason || null,
            photoSubmittedAt: submittedAt,
            status: 'completed',
          })
          .where(
            and(
              eq(quests.id, questId),
              eq(quests.status, 'pending'),
            ),
          )
          .returning()

        if (!updated) {
          throw new Error('PHOTO_ALREADY_SUBMITTED')
        }

        await tx
          .update(users)
          .set({
            stars: sql`${users.stars} + ${quest.points}`,
          })
          .where(eq(users.id, quest.receiverId))

        return updated
      })

      const receiverName = await getUserName(quest.receiverId)
      void sendPushToUser(quest.senderId, {
        title: 'Photo Quest สำเร็จแล้ว 📷⭐',
        body: `${receiverName} ทำ “${quest.title}” สำเร็จแล้ว`,
        url: '/',
      })

      return res.json(updatedQuest)
    } catch (error) {
      console.error(error)
      removeUploadedFile(req.file)

      if (
        error instanceof Error &&
        error.message === 'PHOTO_ALREADY_SUBMITTED'
      ) {
        return res.status(409).json({ error: 'Quest นี้ส่งรูปแล้ว' })
      }

      return res.status(500).json({ error: 'ส่งรูปไม่สำเร็จ' })
    }
  },
)

app.patch('/api/quests/:id/approve', async (req, res) => {
  try {
    const questId = Number(req.params.id)

    if (Number.isNaN(questId)) {
      return res.status(400).json({ error: 'Quest ID ไม่ถูกต้อง' })
    }

    const [quest] = await db
      .select()
      .from(quests)
      .where(eq(quests.id, questId))
      .limit(1)

    if (!quest) {
      return res.status(404).json({ error: 'ไม่พบ Quest' })
    }

    if (quest.status !== 'review') {
      return res.status(409).json({ error: 'Quest นี้ไม่ได้อยู่ในสถานะรอตรวจ' })
    }

    const updatedQuest = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(quests)
        .set({ status: 'completed' })
        .where(
          and(
            eq(quests.id, questId),
            eq(quests.status, 'review'),
          ),
        )
        .returning()

      if (!updated) {
        throw new Error('ALREADY_APPROVED')
      }

      await tx
        .update(users)
        .set({
          stars: sql`${users.stars} + ${quest.points}`,
        })
        .where(eq(users.id, quest.receiverId))

      return updated
    })

    void sendPushToUser(quest.receiverId, {
      title: 'เควสผ่านแล้ว ⭐',
      body: `“${quest.title}” ผ่านแล้ว ได้รับ ${quest.points} ดาว`,
      url: '/',
    })

    return res.json(updatedQuest)
  } catch (error) {
    console.error(error)

    if (error instanceof Error && error.message === 'ALREADY_APPROVED') {
      return res.status(409).json({ error: 'Quest นี้ถูกอนุมัติแล้ว' })
    }

    return res.status(500).json({ error: 'อนุมัติ Quest ไม่สำเร็จ' })
  }
})

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error)

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'รูปต้องมีขนาดไม่เกิน 10 MB' })
      }
    }

    if (error instanceof Error) {
      return res.status(400).json({ error: error.message })
    }

    return res.status(500).json({ error: 'เกิดข้อผิดพลาด' })
  },
)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API running on port ${PORT}`)
  console.log(`Allowed frontend origins: ${FRONTEND_URLS.join(', ')}`)
  console.log(`Upload directory: ${UPLOAD_DIR}`)
  console.log(`Web Push: ${PUSH_ENABLED ? 'enabled' : 'disabled'}`)
})
