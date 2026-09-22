import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

export const questStatusEnum = pgEnum('quest_status', [
  'pending',
  'review',
  'completed',
])

export const verifyTypeEnum = pgEnum('verify_type', [
  'review',
  'instant',
])

export const questTypeEnum = pgEnum('quest_type', [
  'normal',
  'photo',
])

export const questModeEnum = pgEnum('quest_mode', [
  'solo',
  'couple',
])

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
  stars: integer('stars').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const quests = pgTable('quests', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 60 }).notNull(),
  description: text('description'),

  icon: varchar('icon', { length: 20 })
    .notNull()
    .default('🎯'),

  questType: questTypeEnum('quest_type')
    .notNull()
    .default('normal'),

  questMode: questModeEnum('quest_mode')
    .notNull()
    .default('solo'),

  senderCompleted: boolean('sender_completed')
    .notNull()
    .default(false),

  receiverCompleted: boolean('receiver_completed')
    .notNull()
    .default(false),

  photoUrl: text('photo_url'),
  photoSubmittedAt: timestamp('photo_submitted_at'),

  requirePhotoReason: boolean('require_photo_reason')
    .notNull()
    .default(false),

  photoReason: text('photo_reason'),

  due: date('due').notNull(),
  points: integer('points').notNull().default(1),

  verifyType: verifyTypeEnum('verify_type')
    .notNull()
    .default('review'),

  status: questStatusEnum('status')
    .notNull()
    .default('pending'),

  senderId: integer('sender_id')
    .notNull()
    .references(() => users.id),

  receiverId: integer('receiver_id')
    .notNull()
    .references(() => users.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const rewardRedemptions = pgTable('reward_redemptions', {
  id: serial('id').primaryKey(),

  userId: integer('user_id')
    .notNull()
    .references(() => users.id),

  reward: varchar('reward', { length: 200 }).notNull(),

  cost: integer('cost')
    .notNull()
    .default(30),

  createdAt: timestamp('created_at')
    .defaultNow()
    .notNull(),
})

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),

  userId: integer('user_id')
    .notNull()
    .references(() => users.id),

  endpoint: text('endpoint')
    .notNull()
    .unique(),

  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),

  createdAt: timestamp('created_at')
    .defaultNow()
    .notNull(),
})
