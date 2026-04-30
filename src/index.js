import pkg from '@whiskeysockets/baileys'
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = pkg
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import cron from 'node-cron'
import http from 'http'
import dotenv from 'dotenv'
import { db } from './db.js'
import { getAIReply } from './ai.js'
import { sendAdminAlert, setAdminSocket } from './alerts.js'

dotenv.config()

let messageCount = 0
let restartCount = 0
const startTime = Date.now()
let latestQR = null
let connectionStatus = 'disconnected'  // 'disconnected' | 'qr' | 'connected' | 'logged_out'

// ── Log capture para SSE ──────────────────────────────────────────────
const LOG_BUFFER_SIZE = 300
const logBuffer = []
const logClients = new Set()

function pushLog(level, ...args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
  const entry = { t: Date.now(), level, msg }
  logBuffer.push(entry)
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift()
  const data = `data: ${JSON.stringify(entry)}\n\n`
  for (const client of logClients) {
    try { client.write(data) } catch { logClients.delete(client) }
  }
}

const _origLog   = console.log
const _origError = console.error
console.log   = (...a) => { _origLog(...a);   pushLog('info',  ...a) }
console.error = (...a) => { _origError(...a); pushLog('error', ...a) }

// ── WhatsApp ──────────────────────────────────────────────────────────
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: {
      level: 'silent', log: () => {}, info: () => {}, warn: () => {},
      error: console.error, trace: () => {}, debug: () => {},
      child: () => ({ level: 'silent', log: () => {}, info: () => {}, warn: () => {}, error: console.error, trace: () => {}, debug: () => {} })
    }
  })

  setAdminSocket(sock)
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      latestQR = qr
      connectionStatus = 'qr'
      console.log('Nuevo QR generado. Escanealo en el dashboard.')
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut
      connectionStatus = shouldReconnect ? 'disconnected' : 'logged_out'
      restartCount++
      console.log(`Conexión cerrada. Código: ${code}. Reconectando: ${shouldReconnect}`)

      if (shouldReconnect) {
        console.log('Reconectando en 5 segundos...')
        setTimeout(connectToWhatsApp, 5000)
      } else {
        await sendAdminAlert('Sesión cerrada de WhatsApp.\nEscaneá el QR de nuevo desde el dashboard.')
        console.log('Sesión cerrada. Necesita nuevo QR.')
      }
    }

    if (connection === 'open') {
      connectionStatus = 'connected'
      latestQR = null
      console.log('Conectado a WhatsApp correctamente')
      await sendAdminAlert(
        'Worker conectado y funcionando.\n' +
        `Hora: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`
      )
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (msg.key.fromMe) continue          // saltar propios
      if (!msg.message) continue            // saltar vacíos

      const jid = msg.key.remoteJid || ''
      if (!jid) continue
      if (jid.endsWith('@g.us')) continue                   // ignorar grupos
      if (jid === 'status@broadcast') continue              // ignorar estados/stories
      // WhatsApp usa @lid (ID interno) en cuentas nuevas en vez del número real
      const isLid = jid.endsWith('@lid')
      const isPhone = jid.endsWith('@s.whatsapp.net')
      if (!isPhone && !isLid) {
        console.log(`[SKIP] JID desconocido: ${jid}`)
        continue
      }

      const identifier = isPhone
        ? jid.replace('@s.whatsapp.net', '')
        : jid.replace('@lid', '')

      console.log(`[MSG] jid=${jid} id=${identifier} lid=${isLid} name=${msg.pushName}`)

      // Leer config de BD (teléfonos se gestionan desde el dashboard, no variables de entorno)
      const settings = await db.getAISettings().catch(() => null)
      const ADMIN    = settings?.admin_phone    || process.env.ADMIN_PHONE    || '5493516002716'
      const REDIRECT = settings?.redirect_phone || process.env.REDIRECT_PHONE || '5493516002716'

      if (identifier === ADMIN) continue

      // Blacklist global (nadie puede chatear)
      if (settings?.blacklist_all) {
        console.log(`[BLOQUEADO] Blacklist global activa — ignorando ${identifier}`)
        continue
      }

      // Whitelist (solo ciertos números permitidos)
      const ALLOWED = (settings?.allowed_phones?.length)
        ? settings.allowed_phones
        : (process.env.ALLOWED_PHONES || '').split(',').map(p => p.trim()).filter(Boolean)
      if (ALLOWED.length > 0 && !ALLOWED.includes(identifier)) {
        console.log(`[BLOQUEADO] "${identifier}" no está en whitelist [${ALLOWED.join(', ')}]`)
        continue
      }

      // Blacklist específica (números bloqueados individualmente)
      const BLACKLIST = settings?.blacklist_phones || []
      if (BLACKLIST.includes(identifier)) {
        console.log(`[BLOQUEADO] "${identifier}" está en blacklist`)
        continue
      }
      console.log(`[PERMITIDO] ${identifier} (${msg.pushName})`)

      const text     = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
      const hasImage = !!msg.message.imageMessage
      const hasAudio = !!msg.message.audioMessage || !!msg.message.pttMessage
      const audioMime = msg.message.audioMessage?.mimetype || msg.message.pttMessage?.mimetype || 'audio/ogg'
      let imageBuffer = null
      let audioBuffer = null

      try {
        if (hasImage) imageBuffer = await downloadMediaMessage(msg, 'buffer', {})
        if (hasAudio) audioBuffer = await downloadMediaMessage(msg, 'buffer', {})

        const contact = await db.upsertContact(identifier, msg.pushName || '')
        const history = await db.getRecentMessages(contact.conversation_id, 10)
        const result  = await getAIReply({ text, hasImage, imageBuffer, hasAudio, audioBuffer, audioMime, history, clientName: msg.pushName || identifier })

        const { reply, agentType, isHandoff, summary } = result

        const saved = text || (hasImage ? '[imagen]' : hasAudio ? '[audio]' : '[mensaje]')
        await db.saveMessage(contact.conversation_id, 'client', saved, 'cliente')
        await db.saveMessage(contact.conversation_id, 'ai', reply, agentType)
        await sock.sendMessage(msg.key.remoteJid, { text: reply })

        // Agente de redirección: enviar resumen al asesor (número desde el dashboard)
        if (isHandoff && summary) {
          const clientName = msg.pushName || identifier
          const adminMsg =
            `🔔 *Cliente derivado a asesor*\n\n` +
            `👤 *Cliente:* ${clientName}\n` +
            `📱 *Número:* ${identifier}\n\n` +
            `📋 *Resumen de la consulta:*\n${summary}\n\n` +
            `⏰ ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`
          try {
            await sock.sendMessage(`${REDIRECT}@s.whatsapp.net`, { text: adminMsg })
            console.log(`[REDIR] Resumen enviado al asesor ${REDIRECT}`)
          } catch (e) {
            console.error('[REDIR] Error enviando resumen al asesor:', e.message)
          }
        }

        messageCount++
        const preview = text || (hasImage ? '[imagen]' : '[audio]')
        console.log(`[${identifier}][${agentType}] → "${preview.substring(0, 40)}" → "${reply.substring(0, 40)}"`)
      } catch (err) {
        console.error(`Error procesando mensaje de ${identifier}:`, err.message)
      }
    }
  })

  return sock
}

// ── HTTP Server ───────────────────────────────────────────────────────
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || ''

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Dashboard-Key, X-Session-Token')
}

async function checkAuth(req, res) {
  // Legacy secret key
  if (DASHBOARD_SECRET && req.headers['x-dashboard-key'] === DASHBOARD_SECRET) return { role: 'superadmin', username: 'system' }
  if (!DASHBOARD_SECRET && !req.headers['x-session-token']) return { role: 'superadmin', username: 'system' }
  // Session token
  const token = req.headers['x-session-token']
  if (token) {
    const user = await db.getUserByToken(token).catch(() => null)
    if (user) return user
  }
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Unauthorized' }))
  return null
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
  })
}

const server = http.createServer(async (req, res) => {
  setCORS(res)

  // Preflight CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url.split('?')[0]

  // ── Endpoints públicos ───────────────────────────────────────────────

  if (url === '/health') {
    return json(res, {
      status: 'ok',
      uptime_minutes: Math.floor((Date.now() - startTime) / 60000),
      messages_processed: messageCount,
      restarts: restartCount,
      wa_status: connectionStatus,
      timestamp: new Date().toISOString()
    })
  }

  if (url === '/qr') {
    if (!latestQR) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<h2 style="font-family:sans-serif;padding:40px">No hay QR — WhatsApp ya está conectado o esperando reconexión.</h2>')
      return
    }
    const qrImage = await QRCode.toDataURL(latestQR)
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!DOCTYPE html><html><body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;padding:40px">
      <h2>Escaneá con WhatsApp</h2>
      <img src="${qrImage}" style="width:300px;height:300px"/>
      <p>Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
      <p><small>Recargá si expiró</small></p>
    </body></html>`)
    return
  }

  // ── Auth público ─────────────────────────────────────────────────────

  if (url === '/api/auth/login' && req.method === 'POST') {
    try {
      const { username, password } = await parseBody(req)
      if (!username || !password) return json(res, { error: 'Credenciales requeridas' }, 400)
      const user = await db.loginUser(username, password)
      if (!user) return json(res, { error: 'Usuario o contraseña incorrectos' }, 401)
      await db.logActivity(user.id, user.username, 'login', { ip: req.socket?.remoteAddress })
      return json(res, { ok: true, user: { id: user.id, username: user.username, name: user.name, role: user.role }, token: user.token })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // ── GET /api/users/me — validate session token (protected via token only) ─
  if (url === '/api/users/me' && req.method === 'GET') {
    const token = req.headers['x-session-token']
    if (!token) return json(res, { error: 'No token' }, 401)
    const user = await db.getUserByToken(token).catch(() => null)
    if (!user) return json(res, { error: 'Invalid token' }, 401)
    return json(res, { user })
  }

  // ── Endpoints protegidos (Dashboard API) ─────────────────────────────

  const authUser = await checkAuth(req, res)
  if (!authUser) return

  // GET /api/status
  if (url === '/api/status' && req.method === 'GET') {
    return json(res, {
      wa_status: connectionStatus,
      uptime_minutes: Math.floor((Date.now() - startTime) / 60000),
      messages_processed: messageCount,
      restarts: restartCount,
    })
  }

  // GET /api/qr — QR como base64 JSON para el dashboard
  if (url === '/api/qr' && req.method === 'GET') {
    if (!latestQR) {
      return json(res, { hasQR: false, status: connectionStatus })
    }
    const qrImage = await QRCode.toDataURL(latestQR)
    return json(res, { hasQR: true, qrImage, status: connectionStatus })
  }

  // GET /api/stats
  if (url === '/api/stats' && req.method === 'GET') {
    try {
      const stats = await db.getStats()
      return json(res, {
        ...stats,
        uptime_minutes: Math.floor((Date.now() - startTime) / 60000),
        messages_processed: messageCount,
        restarts: restartCount,
        wa_status: connectionStatus,
      })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // GET /api/stats/weekly
  if (url === '/api/stats/weekly' && req.method === 'GET') {
    try {
      const data = await db.getWeeklyActivity()
      return json(res, { data })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // GET /api/stats/hourly
  if (url === '/api/stats/hourly' && req.method === 'GET') {
    try {
      const data = await db.getHourlyActivity()
      return json(res, { data })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // GET /api/conversations
  if (url === '/api/conversations' && req.method === 'GET') {
    try {
      const conversations = await db.getConversations()
      return json(res, { conversations })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // GET /api/conversations/:id/messages
  const convMsgMatch = url.match(/^\/api\/conversations\/(\d+)\/messages$/)
  if (convMsgMatch && req.method === 'GET') {
    try {
      const messages = await db.getMessages(parseInt(convMsgMatch[1]))
      return json(res, { messages })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // GET /api/settings
  if (url === '/api/settings' && req.method === 'GET') {
    try {
      const settings = await db.getAISettings()
      return json(res, { settings })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // PUT /api/settings
  if (url === '/api/settings' && req.method === 'PUT') {
    try {
      const body = await parseBody(req)
      const settings = await db.updateAISettings(body)
      console.log('[Config] Configuración actualizada desde el dashboard')
      return json(res, { ok: true, settings })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // ── Products CRUD ────────────────────────────────────────────────

  // GET /api/products
  if (url === '/api/products' && req.method === 'GET') {
    try {
      const products = await db.getProducts()
      return json(res, { products })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // POST /api/products
  if (url === '/api/products' && req.method === 'POST') {
    try {
      const body = await parseBody(req)
      const product = await db.createProduct(body)
      // Save images if provided
      if (body.images?.length) {
        for (const img of body.images) {
          if (img.src) await db.addProductImage(product.id, img.src, img.name || null)
        }
      }
      console.log(`[Productos] Creado: ${product.name}`)
      return json(res, { ok: true, product })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // PUT /api/products/:id
  const prodMatch = url.match(/^\/api\/products\/(\d+)$/)
  if (prodMatch && req.method === 'PUT') {
    try {
      const body = await parseBody(req)
      const id = parseInt(prodMatch[1])
      const product = await db.updateProduct(id, body)
      // New images (have src but no id) → insert
      if (Array.isArray(body.images)) {
        for (const img of body.images) {
          if (img.src && !img.id) await db.addProductImage(id, img.src, img.name || null)
        }
      }
      console.log(`[Productos] Actualizado: ${product?.name}`)
      return json(res, { ok: true, product })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // DELETE /api/products/:id
  if (prodMatch && req.method === 'DELETE') {
    try {
      await db.deleteProduct(parseInt(prodMatch[1]))
      return json(res, { ok: true })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // ── Catalog images CRUD ──────────────────────────────────────────

  // GET /api/catalog
  if (url === '/api/catalog' && req.method === 'GET') {
    try {
      const images = await db.getCatalogImages()
      return json(res, { images })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // POST /api/catalog
  if (url === '/api/catalog' && req.method === 'POST') {
    try {
      const body = await parseBody(req)
      if (!body.name || !body.image_data) return json(res, { error: 'name e image_data requeridos' }, 400)
      const image = await db.addCatalogImage(body)
      console.log(`[Catálogo] Imagen agregada: ${body.name}`)
      return json(res, { ok: true, image })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // PUT /api/catalog/:id
  const catEditMatch = url.match(/^\/api\/catalog\/(\d+)$/)
  if (catEditMatch && req.method === 'PUT') {
    try {
      const body = await parseBody(req)
      const image = await db.updateCatalogImage(parseInt(catEditMatch[1]), body)
      return json(res, { ok: true, image })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // DELETE /api/catalog/:id
  const catDelMatch = url.match(/^\/api\/catalog\/(\d+)$/)
  if (catDelMatch && req.method === 'DELETE') {
    try {
      await db.deleteCatalogImage(parseInt(catDelMatch[1]))
      return json(res, { ok: true })
    } catch (err) {
      return json(res, { error: err.message }, 500)
    }
  }

  // ── Users CRUD ───────────────────────────────────────────────────

  // GET /api/users
  if (url === '/api/users' && req.method === 'GET') {
    try {
      const users = await db.getUsers()
      return json(res, { users })
    } catch (err) { return json(res, { error: err.message }, 500) }
  }

  // POST /api/users
  if (url === '/api/users' && req.method === 'POST') {
    try {
      const body = await parseBody(req)
      if (!body.username || !body.password) return json(res, { error: 'username y password requeridos' }, 400)
      const user = await db.createUser(body)
      await db.logActivity(authUser.id, authUser.username, 'crear_usuario', { username: body.username, role: body.role })
      return json(res, { ok: true, user })
    } catch (err) { return json(res, { error: err.message }, 500) }
  }

  // PUT /api/users/:id
  const userMatch = url.match(/^\/api\/users\/(\d+)$/)
  if (userMatch && req.method === 'PUT') {
    try {
      const body = await parseBody(req)
      const user = await db.updateUser(parseInt(userMatch[1]), body)
      await db.logActivity(authUser.id, authUser.username, 'editar_usuario', { id: userMatch[1] })
      return json(res, { ok: true, user })
    } catch (err) { return json(res, { error: err.message }, 500) }
  }

  // DELETE /api/users/:id
  if (userMatch && req.method === 'DELETE') {
    try {
      await db.deleteUser(parseInt(userMatch[1]))
      await db.logActivity(authUser.id, authUser.username, 'eliminar_usuario', { id: userMatch[1] })
      return json(res, { ok: true })
    } catch (err) { return json(res, { error: err.message }, 500) }
  }

  // ── Activity log ─────────────────────────────────────────────────

  // GET /api/activity
  if (url === '/api/activity' && req.method === 'GET') {
    try {
      const logs = await db.getActivityLog(200)
      return json(res, { logs })
    } catch (err) { return json(res, { error: err.message }, 500) }
  }

  // POST /api/activity
  if (url === '/api/activity' && req.method === 'POST') {
    try {
      const { action, details } = await parseBody(req)
      await db.logActivity(authUser.id, authUser.username, action, details)
      return json(res, { ok: true })
    } catch (err) { return json(res, { error: err.message }, 500) }
  }

  // GET /logs/stream — SSE en tiempo real
  if (url === '/logs/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    // Enviar historial reciente
    for (const entry of logBuffer) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`)
    }

    // Agregar cliente a la lista de streaming
    logClients.add(res)

    // Keepalive cada 25s
    const keepAlive = setInterval(() => res.write(':ping\n\n'), 25000)

    req.on('close', () => {
      logClients.delete(res)
      clearInterval(keepAlive)
    })
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(process.env.PORT || 3000, () => {
  console.log(`AIWorker corriendo en puerto ${process.env.PORT || 3000}`)
})

// ── Reporte diario 9am Argentina ──────────────────────────────────────
cron.schedule('0 12 * * *', async () => {
  try {
    const stats = await db.getStats()
    const uptimeHrs = Math.floor((Date.now() - startTime) / 3600000)
    await sendAdminAlert(
      `*Reporte diario*\n` +
      `Mensajes hoy: ${stats.messages_24h}\n` +
      `Contactos totales: ${stats.total_contacts}\n` +
      `Mensajes totales: ${stats.total_messages}\n` +
      `Uptime: ${uptimeHrs}hs\n` +
      `Reinicios: ${restartCount}\n` +
      `Estado: ${connectionStatus}`
    )
  } catch (err) {
    console.error('Error enviando reporte diario:', err.message)
  }
}, { timezone: 'America/Argentina/Buenos_Aires' })

// ── Alerta RAM ────────────────────────────────────────────────────────
setInterval(async () => {
  const used = process.memoryUsage().heapUsed / 1024 / 1024
  const total = 512
  const pct = Math.round((used / total) * 100)
  if (pct > 70) {
    await sendAdminAlert(
      `*Alerta de RAM*\nUso: ${used.toFixed(0)}MB / ${total}MB (${pct}%)\nConsidera el plan pago.`
    )
  }
}, 1000 * 60 * 30)

// ── Arrancar ──────────────────────────────────────────────────────────
console.log('Iniciando worker de WhatsApp...')
connectToWhatsApp()
