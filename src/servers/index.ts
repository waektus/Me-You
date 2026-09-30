import 'dotenv/config'

import { randomUUID } from 'node:crypto'

import cors from 'cors'
import express from 'express'
import multer from 'multer'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import { and, desc, eq, gte, sql } from 'drizzle-orm'

import { db } from './db'
import { artworks, pushSubscriptions, quests, rewardRedemptions, songs, users } from './db/schema'

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

const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ?? 'quest-photos'

const STORAGE_ENABLED = Boolean(
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_STORAGE_BUCKET,
)

const supabase = STORAGE_ENABLED
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null

const upload = multer({
  storage: multer.memoryStorage(),
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

function getImageExtension(file: Express.Multer.File) {
  const extensionByMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
  }

  return extensionByMime[file.mimetype] ?? 'jpg'
}

async function deleteStoredPhoto(path: string | null) {
  if (!supabase || !path) return

  const { error } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .remove([path])

  if (error) {
    console.error('delete Supabase Storage photo failed', error)
  }
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

app.get('/api/artworks', async (_req, res) => {
  try {
    const data = await db
      .select()
      .from(artworks)
      .orderBy(desc(artworks.createdAt))

    res.json(data)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'โหลดหอศิลป์ไม่สำเร็จ' })
  }
})

app.post('/api/artworks', upload.single('image'), async (req, res) => {
  let uploadedPath: string | null = null

  try {
    const userId = Number(req.body.userId)
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
    const description =
      typeof req.body.description === 'string'
        ? req.body.description.trim()
        : ''

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'User ID ไม่ถูกต้อง' })
    }

    if (!title) {
      return res.status(400).json({ error: 'กรุณาใส่ชื่อผลงาน' })
    }

    if (title.length > 100) {
      return res.status(400).json({ error: 'ชื่อผลงานต้องไม่เกิน 100 ตัวอักษร' })
    }

    if (description.length > 500) {
      return res.status(400).json({ error: 'คำบรรยายต้องไม่เกิน 500 ตัวอักษร' })
    }

    if (!req.file) {
      return res.status(400).json({ error: 'กรุณาเลือกรูปผลงาน' })
    }

    if (!supabase) {
      return res.status(500).json({
        error: 'ยังไม่ได้ตั้งค่า Supabase Storage บนเซิร์ฟเวอร์',
      })
    }

    const [user] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!user) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    }

    const extension = getImageExtension(req.file)
    uploadedPath =
      `artworks/${userId}/${Date.now()}-${randomUUID()}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(uploadedPath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadError) {
      console.error('Supabase Storage artwork upload failed', uploadError)
      return res.status(500).json({ error: 'อัปโหลดผลงานไม่สำเร็จ' })
    }

    const { data: publicUrlData } = supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .getPublicUrl(uploadedPath)

    const [artwork] = await db
      .insert(artworks)
      .values({
        title,
        description: description || null,
        imageUrl: publicUrlData.publicUrl,
        storagePath: uploadedPath,
        userId,
      })
      .returning()

    uploadedPath = null

    const allUsers = await db.select({ id: users.id }).from(users)

    for (const other of allUsers) {
      if (other.id === userId) continue

      void sendPushToUser(other.id, {
        title: 'มีผลงานใหม่ในหอศิลป์ 🎨',
        body: `${user.name} เพิ่ม “${artwork.title}” ไว้ในหอศิลป์ของเรา`,
        url: '/',
      })
    }

    return res.status(201).json(artwork)
  } catch (error) {
    console.error(error)

    if (uploadedPath) {
      await deleteStoredPhoto(uploadedPath)
    }

    return res.status(500).json({ error: 'เพิ่มผลงานไม่สำเร็จ' })
  }
})


function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function getYouTubeVideoId(value: string) {
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()

    if (host === 'youtu.be') {
      return url.pathname.split('/').filter(Boolean)[0] ?? null
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com'
    ) {
      const fromQuery = url.searchParams.get('v')
      if (fromQuery) return fromQuery

      const parts = url.pathname.split('/').filter(Boolean)

      if (parts[0] === 'shorts' || parts[0] === 'embed') {
        return parts[1] ?? null
      }
    }

    return null
  } catch {
    return null
  }
}

async function getAutomaticSongCover(songUrl: string) {
  try {
    const url = new URL(songUrl)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()

    const youtubeId = getYouTubeVideoId(songUrl)

    if (youtubeId) {
      return `https://i.ytimg.com/vi/${encodeURIComponent(youtubeId)}/hqdefault.jpg`
    }

    if (host === 'open.spotify.com') {
      const response = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(songUrl)}`,
        {
          headers: {
            accept: 'application/json',
          },
        },
      )

      if (!response.ok) return null

      const data = (await response.json()) as {
        thumbnail_url?: unknown
      }

      return typeof data.thumbnail_url === 'string' && data.thumbnail_url
        ? data.thumbnail_url
        : null
    }

    return null
  } catch (error) {
    console.error('automatic song cover failed', error)
    return null
  }
}

app.get('/api/songs/cover', async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : ''

  if (!url || !isHttpUrl(url)) {
    return res.status(400).json({ error: 'ลิงก์เพลงไม่ถูกต้อง' })
  }

  const coverUrl = await getAutomaticSongCover(url)

  return res.json({
    coverUrl,
  })
})

app.get('/api/songs', async (_req, res) => {
  try {
    const data = await db
      .select()
      .from(songs)
      .orderBy(desc(songs.createdAt))

    // เพลงเก่าที่สร้างก่อนมีระบบ Auto Cover อาจมี coverUrl = null
    // ดึงปกย้อนหลังให้ และบันทึกกลับฐานข้อมูลครั้งเดียว
    const songsWithCovers = await Promise.all(
      data.map(async (song) => {
        if (song.coverUrl) {
          return song
        }

        const coverUrl = await getAutomaticSongCover(song.url)

        if (!coverUrl) {
          return song
        }

        try {
          await db
            .update(songs)
            .set({ coverUrl })
            .where(eq(songs.id, song.id))
        } catch (error) {
          // ต่อให้บันทึกย้อนหลังไม่ได้ ก็ยังส่ง URL ปกให้หน้าเว็บใช้รอบนี้ได้
          console.error(`save song cover failed: ${song.id}`, error)
        }

        return {
          ...song,
          coverUrl,
        }
      }),
    )

    return res.json(songsWithCovers)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'โหลดห้องเพลงไม่สำเร็จ' })
  }
})

app.post('/api/songs', async (req, res) => {
  try {
    const userId = Number(req.body.userId)
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
    const artist =
      typeof req.body.artist === 'string' ? req.body.artist.trim() : ''
    const url = typeof req.body.url === 'string' ? req.body.url.trim() : ''
    const message =
      typeof req.body.message === 'string' ? req.body.message.trim() : ''

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'User ID ไม่ถูกต้อง' })
    }

    if (!title || !artist || !url) {
      return res.status(400).json({
        error: 'กรุณาใส่ชื่อเพลง ศิลปิน และลิงก์เพลง',
      })
    }

    if (title.length > 120 || artist.length > 120) {
      return res.status(400).json({
        error: 'ชื่อเพลงและศิลปินต้องไม่เกิน 120 ตัวอักษร',
      })
    }

    if (message.length > 500) {
      return res.status(400).json({ error: 'ข้อความต้องไม่เกิน 500 ตัวอักษร' })
    }

    if (!isHttpUrl(url)) {
      return res.status(400).json({ error: 'ลิงก์เพลงไม่ถูกต้อง' })
    }

    const coverUrl = await getAutomaticSongCover(url)

    const [user] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!user) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    }

    const [song] = await db
      .insert(songs)
      .values({
        title,
        artist,
        url,
        coverUrl: coverUrl || null,
        message: message || null,
        userId,
      })
      .returning()

    const allUsers = await db.select({ id: users.id }).from(users)

    for (const other of allUsers) {
      if (other.id === userId) continue

      void sendPushToUser(other.id, {
        title: 'มีเพลงใหม่ในห้องของเรา 🎵',
        body: `${user.name} เก็บ “${song.title}” - ${song.artist} ไว้ให้แล้ว`,
        url: '/',
      })
    }

    return res.status(201).json(song)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'เพิ่มเพลงไม่สำเร็จ' })
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
      questMode,
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

    if (Number(senderId) === Number(receiverId)) {
      return res.status(400).json({ error: 'Couple Quest ต้องมีผู้ใช้ 2 คน' })
    }

    if (verifyType !== 'review' && verifyType !== 'instant') {
      return res.status(400).json({ error: 'verifyType ไม่ถูกต้อง' })
    }

    const cleanQuestMode = questMode === 'couple' ? 'couple' : 'solo'
    const cleanQuestType = questType === 'photo' ? 'photo' : 'normal'
    const defaultIcon =
      cleanQuestMode === 'couple'
        ? cleanQuestType === 'photo'
          ? '💞'
          : '💞'
        : cleanQuestType === 'photo'
          ? '📷'
          : '🎯'

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
        questMode: cleanQuestMode,
        senderCompleted: false,
        receiverCompleted: false,
        requirePhotoReason:
          cleanQuestType === 'photo'
            ? Boolean(requirePhotoReason)
            : false,
        due: String(due),
        points: Number(points) || 1,
        verifyType: cleanQuestMode === 'couple' ? 'instant' : verifyType,
        status: 'pending',
        senderId: Number(senderId),
        receiverId: Number(receiverId),
      })
      .returning()

    const senderName = await getUserName(newQuest.senderId)
    void sendPushToUser(newQuest.receiverId, {
      title:
        newQuest.questMode === 'couple'
          ? newQuest.questType === 'photo'
            ? 'มี Couple Photo Quest ใหม่ 💞📷'
            : 'มี Couple Quest ใหม่ 💞'
          : 'มีเควสใหม่ 🎯',
      body:
        newQuest.questMode === 'couple'
          ? newQuest.questType === 'photo'
            ? `${senderName} ชวนคุณถ่ายรูปสำหรับ “${newQuest.title}” ด้วยกัน`
            : `${senderName} ชวนคุณทำ “${newQuest.title}” ด้วยกัน`
          : `${senderName} ส่งเควส “${newQuest.title}” ให้คุณ`,
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

    if (quest.questMode === 'couple') {
      return res.status(400).json({
        error: 'Couple Quest ต้องใช้การยืนยันของแต่ละคน',
      })
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


app.patch('/api/quests/:id/couple-complete', async (req, res) => {
  try {
    const questId = Number(req.params.id)
    const userId = Number(req.body.userId)

    if (!Number.isInteger(questId) || questId <= 0) {
      return res.status(400).json({ error: 'Quest ID ไม่ถูกต้อง' })
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'User ID ไม่ถูกต้อง' })
    }

    const result = await db.transaction(async (tx) => {
      const [quest] = await tx
        .select()
        .from(quests)
        .where(eq(quests.id, questId))
        .limit(1)

      if (!quest) {
        throw new Error('QUEST_NOT_FOUND')
      }

      if (quest.questMode !== 'couple') {
        throw new Error('NOT_COUPLE_QUEST')
      }

      if (quest.questType === 'photo') {
        throw new Error('PHOTO_REQUIRED')
      }

      if (quest.status !== 'pending') {
        throw new Error('COUPLE_QUEST_FINISHED')
      }

      const isSender = quest.senderId === userId
      const isReceiver = quest.receiverId === userId

      if (!isSender && !isReceiver) {
        throw new Error('NOT_PARTICIPANT')
      }

      if (
        (isSender && quest.senderCompleted) ||
        (isReceiver && quest.receiverCompleted)
      ) {
        throw new Error('ALREADY_CONFIRMED')
      }

      const completionColumn = isSender
        ? quests.senderCompleted
        : quests.receiverCompleted

      const [updatedQuest] = await tx
        .update(quests)
        .set(
          isSender
            ? { senderCompleted: true }
            : { receiverCompleted: true },
        )
        .where(
          and(
            eq(quests.id, questId),
            eq(quests.status, 'pending'),
            eq(completionColumn, false),
          ),
        )
        .returning()

      if (!updatedQuest) {
        throw new Error('ALREADY_CONFIRMED')
      }

      if (!updatedQuest.senderCompleted || !updatedQuest.receiverCompleted) {
        return {
          quest: updatedQuest,
          completedNow: false,
        }
      }

      const [completedQuest] = await tx
        .update(quests)
        .set({ status: 'completed' })
        .where(
          and(
            eq(quests.id, questId),
            eq(quests.status, 'pending'),
            eq(quests.senderCompleted, true),
            eq(quests.receiverCompleted, true),
          ),
        )
        .returning()

      if (!completedQuest) {
        return {
          quest: updatedQuest,
          completedNow: false,
        }
      }

      await tx
        .update(users)
        .set({
          stars: sql`${users.stars} + ${quest.points}`,
        })
        .where(eq(users.id, quest.senderId))

      await tx
        .update(users)
        .set({
          stars: sql`${users.stars} + ${quest.points}`,
        })
        .where(eq(users.id, quest.receiverId))

      return {
        quest: completedQuest,
        completedNow: true,
      }
    })

    const actorName = await getUserName(userId)

    if (result.completedNow) {
      const message = {
        title: 'Couple Quest สำเร็จแล้ว 💞⭐',
        body: `“${result.quest.title}” สำเร็จแล้ว ทั้งคู่ได้รับ ${result.quest.points} ดาว`,
        url: '/',
      }

      void sendPushToUser(result.quest.senderId, message)

      if (result.quest.receiverId !== result.quest.senderId) {
        void sendPushToUser(result.quest.receiverId, message)
      }
    } else {
      const otherUserId =
        result.quest.senderId === userId
          ? result.quest.receiverId
          : result.quest.senderId

      void sendPushToUser(otherUserId, {
        title: 'อีกฝ่ายทำส่วนของตัวเองแล้ว 💞',
        body: `${actorName} ยืนยัน “${result.quest.title}” แล้ว เหลือคุณอีกคนนะ`,
        url: '/',
      })
    }

    return res.json({
      quest: result.quest,
      completed: result.completedNow,
    })
  } catch (error) {
    console.error(error)

    if (error instanceof Error) {
      if (error.message === 'QUEST_NOT_FOUND') {
        return res.status(404).json({ error: 'ไม่พบ Quest' })
      }

      if (error.message === 'NOT_COUPLE_QUEST') {
        return res.status(400).json({ error: 'Quest นี้ไม่ใช่ Couple Quest' })
      }

      if (error.message === 'NOT_PARTICIPANT') {
        return res.status(403).json({ error: 'คุณไม่ได้อยู่ใน Couple Quest นี้' })
      }

      if (error.message === 'PHOTO_REQUIRED') {
        return res.status(400).json({
          error: 'Couple Photo Quest ต้องส่งรูปของตัวเอง',
        })
      }

      if (error.message === 'ALREADY_CONFIRMED') {
        return res.status(409).json({ error: 'คุณยืนยันเควสนี้แล้ว' })
      }

      if (error.message === 'COUPLE_QUEST_FINISHED') {
        return res.status(409).json({ error: 'Couple Quest นี้จบแล้ว' })
      }
    }

    return res.status(500).json({ error: 'ยืนยัน Couple Quest ไม่สำเร็จ' })
  }
})

app.post(
  '/api/quests/:id/couple-photo',
  upload.single('photo'),
  async (req, res) => {
    let uploadedPath: string | null = null

    try {
      const questId = Number(req.params.id)
      const userId = Number(req.body.userId)

      if (!Number.isInteger(questId) || questId <= 0) {
        return res.status(400).json({ error: 'Quest ID ไม่ถูกต้อง' })
      }

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'User ID ไม่ถูกต้อง' })
      }

      if (!req.file) {
        return res.status(400).json({ error: 'ไม่พบรูปภาพ' })
      }

      if (!supabase) {
        return res.status(500).json({
          error: 'ยังไม่ได้ตั้งค่า Supabase Storage บนเซิร์ฟเวอร์',
        })
      }

      const [quest] = await db
        .select()
        .from(quests)
        .where(eq(quests.id, questId))
        .limit(1)

      if (!quest) {
        return res.status(404).json({ error: 'ไม่พบ Quest' })
      }

      if (quest.questMode !== 'couple' || quest.questType !== 'photo') {
        return res.status(400).json({
          error: 'Quest นี้ไม่ใช่ Couple Photo Quest',
        })
      }

      if (quest.status !== 'pending') {
        return res.status(409).json({ error: 'Couple Photo Quest นี้จบแล้ว' })
      }

      const isSender = quest.senderId === userId
      const isReceiver = quest.receiverId === userId

      if (!isSender && !isReceiver) {
        return res.status(403).json({
          error: 'คุณไม่ได้อยู่ใน Couple Quest นี้',
        })
      }

      if (
        (isSender && quest.senderCompleted) ||
        (isReceiver && quest.receiverCompleted)
      ) {
        return res.status(409).json({ error: 'คุณส่งรูปสำหรับเควสนี้แล้ว' })
      }

      const photoReason =
        typeof req.body.photoReason === 'string'
          ? req.body.photoReason.trim()
          : ''

      if (quest.requirePhotoReason && !photoReason) {
        return res.status(400).json({
          error: 'เควสนี้ต้องอธิบายเหตุผลที่ถ่าย',
        })
      }

      if (photoReason.length > 300) {
        return res.status(400).json({
          error: 'เหตุผลต้องไม่เกิน 300 ตัวอักษร',
        })
      }

      const extension = getImageExtension(req.file)
      uploadedPath =
        `quests/${quest.id}/couple/${userId}/${Date.now()}-${randomUUID()}.${extension}`

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .upload(uploadedPath, req.file.buffer, {
          contentType: req.file.mimetype,
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        console.error('Supabase Storage couple photo upload failed', uploadError)
        return res.status(500).json({
          error: 'อัปโหลดรูปขึ้น Storage ไม่สำเร็จ',
        })
      }

      const { data: publicUrlData } = supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .getPublicUrl(uploadedPath)

      const photoUrl = publicUrlData.publicUrl
      const submittedAt = new Date()

      const result = await db.transaction(async (tx) => {
        const completionColumn = isSender
          ? quests.senderCompleted
          : quests.receiverCompleted

        const updateValues = isSender
          ? {
              senderCompleted: true,
              senderPhotoUrl: photoUrl,
              senderPhotoSubmittedAt: submittedAt,
              senderPhotoReason: photoReason || null,
            }
          : {
              receiverCompleted: true,
              receiverPhotoUrl: photoUrl,
              receiverPhotoSubmittedAt: submittedAt,
              receiverPhotoReason: photoReason || null,
            }

        const [updatedQuest] = await tx
          .update(quests)
          .set(updateValues)
          .where(
            and(
              eq(quests.id, questId),
              eq(quests.status, 'pending'),
              eq(completionColumn, false),
            ),
          )
          .returning()

        if (!updatedQuest) {
          throw new Error('ALREADY_SUBMITTED')
        }

        if (!updatedQuest.senderCompleted || !updatedQuest.receiverCompleted) {
          return {
            quest: updatedQuest,
            completedNow: false,
          }
        }

        const [completedQuest] = await tx
          .update(quests)
          .set({ status: 'completed' })
          .where(
            and(
              eq(quests.id, questId),
              eq(quests.status, 'pending'),
              eq(quests.senderCompleted, true),
              eq(quests.receiverCompleted, true),
            ),
          )
          .returning()

        if (!completedQuest) {
          return {
            quest: updatedQuest,
            completedNow: false,
          }
        }

        await tx
          .update(users)
          .set({
            stars: sql`${users.stars} + ${quest.points}`,
          })
          .where(eq(users.id, quest.senderId))

        await tx
          .update(users)
          .set({
            stars: sql`${users.stars} + ${quest.points}`,
          })
          .where(eq(users.id, quest.receiverId))

        return {
          quest: completedQuest,
          completedNow: true,
        }
      })

      uploadedPath = null

      const actorName = await getUserName(userId)

      if (result.completedNow) {
        const message = {
          title: 'Couple Photo Quest สำเร็จแล้ว 💞📷⭐',
          body: `รูปของ “${result.quest.title}” ครบทั้งคู่แล้ว ได้รับคนละ ${result.quest.points} ดาว`,
          url: '/',
        }

        void sendPushToUser(result.quest.senderId, message)

        if (result.quest.receiverId !== result.quest.senderId) {
          void sendPushToUser(result.quest.receiverId, message)
        }
      } else {
        const otherUserId =
          result.quest.senderId === userId
            ? result.quest.receiverId
            : result.quest.senderId

        void sendPushToUser(otherUserId, {
          title: 'อีกฝ่ายส่งรูปแล้ว 💞📷',
          body: `${actorName} ส่งรูปสำหรับ “${result.quest.title}” แล้ว เหลือรูปของคุณนะ`,
          url: '/',
        })
      }

      return res.json({
        quest: result.quest,
        completed: result.completedNow,
      })
    } catch (error) {
      console.error(error)

      if (uploadedPath) {
        await deleteStoredPhoto(uploadedPath)
      }

      if (error instanceof Error && error.message === 'ALREADY_SUBMITTED') {
        return res.status(409).json({ error: 'คุณส่งรูปสำหรับเควสนี้แล้ว' })
      }

      return res.status(500).json({
        error: 'ส่งรูป Couple Photo Quest ไม่สำเร็จ',
      })
    }
  },
)

app.post(
  '/api/quests/:id/photo',
  upload.single('photo'),
  async (req, res) => {
    let uploadedPath: string | null = null

    try {
      const questId = Number(req.params.id)

      if (Number.isNaN(questId)) {
        return res.status(400).json({ error: 'Quest ID ไม่ถูกต้อง' })
      }

      if (!req.file) {
        return res.status(400).json({ error: 'ไม่พบรูปภาพ' })
      }

      if (!supabase) {
        return res.status(500).json({
          error: 'ยังไม่ได้ตั้งค่า Supabase Storage บนเซิร์ฟเวอร์',
        })
      }

      const [quest] = await db
        .select()
        .from(quests)
        .where(eq(quests.id, questId))
        .limit(1)

      if (!quest) {
        return res.status(404).json({ error: 'ไม่พบ Quest' })
      }

      if (quest.questMode === 'couple') {
        return res.status(400).json({
          error: 'Couple Quest ไม่ใช้การส่งรูปในโหมดนี้',
        })
      }

      if (quest.questType !== 'photo') {
        return res.status(400).json({ error: 'Quest นี้ไม่ใช่เควสถ่ายภาพ' })
      }

      if (quest.status !== 'pending') {
        return res.status(409).json({ error: 'Quest นี้ส่งรูปแล้ว' })
      }

      const photoReason =
        typeof req.body.photoReason === 'string'
          ? req.body.photoReason.trim()
          : ''

      if (quest.requirePhotoReason && !photoReason) {
        return res.status(400).json({
          error: 'เควสนี้ต้องอธิบายเหตุผลที่ถ่าย',
        })
      }

      if (photoReason.length > 300) {
        return res.status(400).json({
          error: 'เหตุผลต้องไม่เกิน 300 ตัวอักษร',
        })
      }

      const extension = getImageExtension(req.file)
      uploadedPath =
        `quests/${quest.id}/${Date.now()}-${randomUUID()}.${extension}`

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .upload(uploadedPath, req.file.buffer, {
          contentType: req.file.mimetype,
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        console.error('Supabase Storage upload failed', uploadError)
        return res.status(500).json({ error: 'อัปโหลดรูปขึ้น Storage ไม่สำเร็จ' })
      }

      const { data: publicUrlData } = supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .getPublicUrl(uploadedPath)

      const photoUrl = publicUrlData.publicUrl
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
          await deleteStoredPhoto(uploadedPath)
          uploadedPath = null
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

      if (uploadedPath) {
        await deleteStoredPhoto(uploadedPath)
      }

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

    if (quest.questMode === 'couple') {
      return res.status(400).json({
        error: 'Couple Quest ไม่ต้องให้อีกฝ่ายอนุมัติ',
      })
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
  console.log(`Supabase Storage: ${STORAGE_ENABLED ? 'enabled' : 'disabled'}`)
  console.log(`Storage bucket: ${SUPABASE_STORAGE_BUCKET}`)
  console.log(`Web Push: ${PUSH_ENABLED ? 'enabled' : 'disabled'}`)
})
