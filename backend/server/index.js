import 'dotenv/config'
import { Buffer } from 'node:buffer'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import process from 'node:process'
import cookieParser from 'cookie-parser'
import express from 'express'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import { MongoClient } from 'mongodb'
import { z } from 'zod'

const scrypt = promisify(scryptCallback)
const jwtSecret =
  process.env.JWT_SECRET ??
  (process.env.NODE_ENV === 'production'
    ? undefined
    : randomBytes(48).toString('base64url'))
const cookieName = 'morrow_session'
const sessionDurationSeconds = 7 * 24 * 60 * 60
const cookieSecure = process.env.NODE_ENV === 'production'
const cookieSameSite = process.env.COOKIE_SAME_SITE ?? (cookieSecure ? 'none' : 'lax')
const allowedOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)
const app = express()

if (!['lax', 'strict', 'none'].includes(cookieSameSite)) {
  throw new Error('COOKIE_SAME_SITE must be lax, strict, or none.')
}

let mongoClient
let database

const authInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(72),
  name: z.string().trim().min(2).max(60).optional(),
  register: z.boolean().default(false),
}).superRefine((input, context) => {
  if (input.register && !input.name) {
    context.addIssue({
      code: 'custom',
      message: 'Enter your name to create an account.',
      path: ['name'],
    })
  }
  if (input.register && input.password.length < 8) {
    context.addIssue({
      code: 'custom',
      message: 'Choose a password with at least 8 characters.',
      path: ['password'],
    })
  }
})

const conversationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
})

const messageInputSchema = z.object({
  text: z.string().trim().min(1).max(4000),
})

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters.')
}

export async function connectToMongoDB() {
  if (database) return database
  if (!process.env.MONGODB_URI) {
    const error = new Error('MONGODB_URI must be configured.')
    error.code = 'MONGODB_CONFIG_MISSING'
    throw error
  }

  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI)
  }

  try {
    await mongoClient.connect()
    database = mongoClient.db()
    await Promise.all([
      database.collection('users').createIndex({ email: 1 }, { unique: true }),
      database.collection('conversations').createIndex({ participants: 1, updatedAt: -1 }),
      database.collection('requests').createIndex({ senderId: 1, status: 1 }),
      database.collection('requests').createIndex({ recipientId: 1, status: 1 }),
      database.collection('messages').createIndex({ conversationId: 1, createdAt: -1 }),
    ])
    return database
  } catch (error) {
    mongoClient = undefined
    database = undefined
    throw error
  }
}

function validId(id) {
  return typeof id === 'string' && /^[a-f0-9]{24}$/.test(id)
}

async function hashPassword(password) {
  const salt = randomBytes(16)
  const derivedKey = await scrypt(password, salt, 64)
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`
}

async function verifyPassword(password, storedHash) {
  const [saltHex, keyHex] = typeof storedHash === 'string' ? storedHash.split(':') : []
  if (!/^[a-f0-9]{32}$/.test(saltHex ?? '') || !/^[a-f0-9]{128}$/.test(keyHex ?? '')) {
    return false
  }

  const expected = Buffer.from(keyHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(expected, actual)
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
  }
}

function setSessionCookie(res, userId) {
  const token = jwt.sign({ userId }, jwtSecret, {
    expiresIn: sessionDurationSeconds,
  })
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    maxAge: sessionDurationSeconds * 1000,
    path: '/',
  })
}

function requireSession(req, res, next) {
  const token = req.cookies[cookieName]
  if (!token) {
    return res.status(401).json({ error: 'Please sign in.' })
  }

  let payload
  try {
    payload = jwt.verify(token, jwtSecret)
  } catch {
    return res.status(401).json({ error: 'Please sign in.' })
  }

  if (typeof payload !== 'object' || !validId(payload.userId)) {
    return res.status(401).json({ error: 'Please sign in.' })
  }

  req.userId = payload.userId
  return next()
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' },
})

const avatarImages = [
  'photo-1534528741775-53994a69daeb',
  'photo-1500648767791-00dcc994a43e',
  'photo-1531123897727-8f129e1688ce',
  'photo-1506794778202-cad84cf45f1d',
]
const avatarColors = ['lilac', 'peach', 'blue', 'green']

function profileFor(user) {
  const seed = [...user._id].reduce((value, character) => value + character.charCodeAt(0), 0)
  return {
    name: user.name,
    email: user.email,
    role: 'Morrow member',
    online: typeof user.onlineUntil === 'number' && user.onlineUntil > Date.now(),
    color: avatarColors[seed % avatarColors.length],
    image: avatarImages[seed % avatarImages.length],
  }
}

function timeLabel(value) {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function conversationIdFor(participants) {
  return [...participants].sort().join('_')
}

async function serializeConversation(db, conversation, userId) {
  const otherId = conversation.participants.find((participant) => participant !== userId)
  if (!otherId) return null

  const [otherUser, messages] = await Promise.all([
    db.collection('users').findOne({ _id: otherId }),
    db.collection('messages')
      .find({ conversationId: conversation._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .toArray(),
  ])
  if (!otherUser) return null

  const orderedMessages = messages.reverse()
  const lastMessage = orderedMessages.at(-1)
  return {
    id: conversation._id,
    ...profileFor(otherUser),
    preview: lastMessage?.text ?? 'Start a conversation',
    time: lastMessage ? timeLabel(lastMessage.createdAt) : '',
    unread: Number(conversation.unreadCounts?.[userId] ?? 0),
    updatedAt: new Date(conversation.updatedAt).toISOString(),
    messages: orderedMessages.map((message) => ({
      id: message._id,
      from: message.senderId === userId ? 'me' : 'them',
      text: message.text,
      time: timeLabel(message.createdAt),
      createdAt: new Date(message.createdAt).toISOString(),
    })),
  }
}

async function ensureConversation(db, participants, now = Date.now()) {
  const sortedParticipants = [...participants].sort()
  const id = conversationIdFor(sortedParticipants)
  await db.collection('conversations').updateOne(
    { _id: id },
    {
      $setOnInsert: {
        participants: sortedParticipants,
        unreadCounts: Object.fromEntries(sortedParticipants.map((participant) => [participant, 0])),
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  )
  return db.collection('conversations').findOne({ _id: id })
}

async function listConnectionRequests(db, userId) {
  const requests = await db.collection('requests')
    .find({
      status: 'pending',
      $or: [{ senderId: userId }, { recipientId: userId }],
    })
    .sort({ createdAt: -1 })
    .toArray()
  const mapped = await Promise.all(requests.map(async (request) => {
    const otherId = request.senderId === userId ? request.recipientId : request.senderId
    const user = await db.collection('users').findOne({ _id: otherId })
    if (!user) return null
    return {
      id: request._id,
      ...profileFor(user),
      createdAt: request.createdAt,
      direction: request.senderId === userId ? 'outgoing' : 'incoming',
    }
  }))
  const pending = mapped.filter(Boolean)
  return {
    incoming: pending.filter((request) => request.direction === 'incoming'),
    outgoing: pending.filter((request) => request.direction === 'outgoing'),
  }
}

app.use((req, res, next) => {
  const origin = req.get('Origin')
  if (!origin || allowedOrigins.length === 0) return next()
  if (!allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'This website is not allowed to access the API.' })
  }

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Vary', 'Origin')
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.sendStatus(204)
  }
  return next()
})

app.use(express.json({ limit: '16kb' }))
app.use(cookieParser())

app.post('/api/auth/session', authLimiter, async (req, res, next) => {
  try {
    const input = authInputSchema.safeParse(req.body)
    if (!input.success) {
      return res.status(400).json({
        error: input.error.issues[0]?.message ?? 'Invalid authentication request.',
      })
    }

    const db = await connectToMongoDB()
    const users = db.collection('users')
    const { email, password, register, name } = input.data
    let user

    if (register) {
      user = {
        _id: randomBytes(12).toString('hex'),
        name,
        email,
        passwordHash: await hashPassword(password),
        createdAt: Date.now(),
      }
      try {
        await users.insertOne(user)
      } catch (error) {
        if (error.code === 11000) {
          return res.status(409).json({
            error: 'This email is already linked to an account. Sign in or use a different email.',
          })
        }
        throw error
      }
    } else {
      user = await users.findOne({ email })
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        return res.status(401).json({ error: 'The email or password is incorrect.' })
      }
    }

    const onlineUntil = Date.now() + 30_000
    await users.updateOne({ _id: user._id }, { $set: { onlineUntil } })
    setSessionCookie(res, user._id)
    return res.json({ user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/presence', requireSession, async (req, res, next) => {
  try {
    const db = await connectToMongoDB()
    const result = await db.collection('users').updateOne(
      { _id: req.userId },
      { $set: { onlineUntil: Date.now() + 30_000 } },
    )
    if (!result.matchedCount) return res.status(401).json({ error: 'Please sign in.' })
    return res.sendStatus(204)
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/me', requireSession, async (req, res, next) => {
  try {
    const db = await connectToMongoDB()
    const user = await db.collection('users').findOne({ _id: req.userId })
    if (!user) return res.status(401).json({ error: 'Please sign in.' })
    return res.json({ user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/logout', requireSession, async (req, res, next) => {
  try {
    const db = await connectToMongoDB()
    await db.collection('users').updateOne({ _id: req.userId }, { $unset: { onlineUntil: '' } })
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: '/',
    })
    return res.sendStatus(204)
  } catch (error) {
    next(error)
  }
})

app.get('/api/requests', requireSession, async (req, res, next) => {
  try {
    return res.json(await listConnectionRequests(await connectToMongoDB(), req.userId))
  } catch (error) {
    next(error)
  }
})

app.post('/api/requests', requireSession, async (req, res, next) => {
  try {
    const input = conversationInputSchema.safeParse(req.body)
    if (!input.success) {
      return res.status(400).json({
        error: input.error.issues[0]?.message ?? 'Enter a valid email address.',
      })
    }

    const db = await connectToMongoDB()
    const recipient = await db.collection('users').findOne({ email: input.data.email })
    if (!recipient) {
      return res.status(404).json({ error: 'No Morrow account was found for that email.' })
    }
    if (recipient._id === req.userId) {
      return res.status(400).json({ error: 'You cannot send a request to yourself.' })
    }

    const participants = [req.userId, recipient._id].sort()
    const requestId = conversationIdFor(participants)
    if (await db.collection('conversations').findOne({ _id: requestId })) {
      return res.status(409).json({ error: 'You already have a conversation with this person.' })
    }

    const requests = db.collection('requests')
    const now = Date.now()
    const current = await requests.findOne({ _id: requestId })
    if (current?.status === 'pending') {
      if (current.senderId !== req.userId) {
        return res.status(409).json({
          error: 'This person has already sent you a request. Accept it from your requests inbox.',
        })
      }
      return res.status(201).json({
        request: { id: requestId, name: recipient.name, email: recipient.email, status: current.status },
      })
    }

    try {
      await requests.updateOne(
        { _id: requestId, status: { $ne: 'pending' } },
        {
          $set: {
            senderId: req.userId,
            recipientId: recipient._id,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      )
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: 'A request with this person is already being handled.' })
      }
      throw error
    }

    return res.status(201).json({
      request: { id: requestId, name: recipient.name, email: recipient.email, status: 'pending' },
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/requests/:id/accept', requireSession, async (req, res, next) => {
  try {
    const requestId = req.params.id
    if (!/^[a-f0-9]{24}_[a-f0-9]{24}$/.test(requestId)) {
      return res.status(400).json({ error: 'Invalid request.' })
    }

    const db = await connectToMongoDB()
    const requests = db.collection('requests')
    const request = await requests.findOne({ _id: requestId, recipientId: req.userId })
    if (!request || !['pending', 'accepted'].includes(request.status)) {
      return res.status(404).json({ error: 'Request not found.' })
    }
    if (request.status === 'pending') {
      const accepted = await requests.updateOne(
        { _id: requestId, recipientId: req.userId, status: 'pending' },
        { $set: { status: 'accepted', updatedAt: Date.now() } },
      )
      if (!accepted.modifiedCount) {
        return res.status(409).json({ error: 'This request has already been handled.' })
      }
    }

    const conversation = await ensureConversation(db, [request.senderId, request.recipientId])
    const result = await serializeConversation(db, conversation, req.userId)
    return res.json({ conversation: result })
  } catch (error) {
    next(error)
  }
})

app.post('/api/requests/:id/decline', requireSession, async (req, res, next) => {
  try {
    const requestId = req.params.id
    if (!/^[a-f0-9]{24}_[a-f0-9]{24}$/.test(requestId)) {
      return res.status(400).json({ error: 'Invalid request.' })
    }

    const db = await connectToMongoDB()
    const result = await db.collection('requests').updateOne(
      { _id: requestId, recipientId: req.userId, status: 'pending' },
      { $set: { status: 'declined', updatedAt: Date.now() } },
    )
    if (!result.modifiedCount) return res.status(404).json({ error: 'Request not found.' })
    return res.sendStatus(204)
  } catch (error) {
    next(error)
  }
})

app.get('/api/conversations', requireSession, async (req, res, next) => {
  try {
    const db = await connectToMongoDB()
    const conversations = await db.collection('conversations')
      .find({ participants: req.userId })
      .sort({ updatedAt: -1 })
      .toArray()
    const results = await Promise.all(
      conversations.map((conversation) => serializeConversation(db, conversation, req.userId)),
    )
    return res.json({ conversations: results.filter(Boolean) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/conversations/:id/read', requireSession, async (req, res, next) => {
  try {
    const conversationId = req.params.id
    if (!/^[a-f0-9]{24}_[a-f0-9]{24}$/.test(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation.' })
    }

    const db = await connectToMongoDB()
    const result = await db.collection('conversations').updateOne(
      { _id: conversationId, participants: req.userId },
      { $set: { [`unreadCounts.${req.userId}`]: 0 } },
    )
    if (!result.matchedCount) return res.status(404).json({ error: 'Conversation not found.' })
    return res.sendStatus(204)
  } catch (error) {
    next(error)
  }
})

app.post('/api/conversations/:id/messages', requireSession, async (req, res, next) => {
  try {
    const conversationId = req.params.id
    if (!/^[a-f0-9]{24}_[a-f0-9]{24}$/.test(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation.' })
    }

    const input = messageInputSchema.safeParse(req.body)
    if (!input.success) {
      return res.status(400).json({
        error: input.error.issues[0]?.message ?? 'Enter a message.',
      })
    }

    const db = await connectToMongoDB()
    const conversations = db.collection('conversations')
    const conversation = await conversations.findOne({
      _id: conversationId,
      participants: req.userId,
    })
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.' })

    const recipientId = conversation.participants.find((participant) => participant !== req.userId)
    if (!recipientId) return res.status(404).json({ error: 'Conversation not found.' })

    const now = Date.now()
    await db.collection('messages').insertOne({
      _id: randomBytes(12).toString('hex'),
      conversationId,
      senderId: req.userId,
      text: input.data.text,
      createdAt: now,
    })
    await conversations.updateOne(
      { _id: conversationId },
      {
        $set: {
          updatedAt: now,
          [`unreadCounts.${req.userId}`]: 0,
        },
        $inc: { [`unreadCounts.${recipientId}`]: 1 },
      },
    )

    const updatedConversation = await conversations.findOne({ _id: conversationId })
    const result = await serializeConversation(db, updatedConversation, req.userId)
    return res.status(201).json({ conversation: result })
  } catch (error) {
    next(error)
  }
})

app.use((error, req, res, next) => {
  console.error(
    `${req.method} ${req.path} failed:`,
    error?.code ?? 'UNKNOWN',
    error?.message,
  )
  if (res.headersSent) return next(error)

  if (error.code === 'MONGODB_CONFIG_MISSING') {
    return res.status(503).json({
      error: 'Authentication and chat are unavailable. Configure MONGODB_URI correctly.',
    })
  }
  if (error.code === 11000) {
    return res.status(409).json({ error: 'An account with this email already exists.' })
  }

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500
  const message = status === 400
    ? 'Invalid JSON request body.'
    : process.env.NODE_ENV === 'production'
      ? 'The request could not be completed. Please try again.'
      : error?.message || 'The request could not be completed. Please try again.'
  return res.status(status).json({ error: message })
})

export default app
