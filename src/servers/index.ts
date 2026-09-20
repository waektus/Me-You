import 'dotenv/config'

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { and, desc, eq, gte, sql } from 'drizzle-orm'

import { db } from './db'
import { quests, rewardRedemptions, users } from './db/schema'

const app = express()
const PORT = Number(process.env.PORT) || 3001

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
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

app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(UPLOAD_DIR))

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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
