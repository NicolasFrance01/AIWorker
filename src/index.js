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

      const ADMIN = process.env.ADMIN_PHONE || '5493516002716'
      if (identifier === ADMIN) continue

      // ALLOWED_PHONES acepta números Y/O LIDs separados por coma
      // Ej en Render: ALLOWED_PHONES=5493512011783,29463626682562
      const ALLOWED = (process.env.ALLOWED_PHONES || '5493512011783,29463626682562').split(',').map(p => p.trim())
      if (!ALLOWED.includes(identifier)) {
        console.log(`[BLOQUEADO] "${identifier}" no está en whitelist [${ALLOWED.join(', ')}]`)
        continue
      }
      console.log(`[PERMITIDO] ${identifier} (${msg.pushName})`)

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
      const hasImage = !!msg.message.imageMessage
      let imageBuffer = null

      try {
        if (hasImage) imageBuffer = await downloadMediaMessage(msg, 'buffer', {})

        const contact = await db.upsertContact(identifier, msg.pushName || '')
        const history = await db.getRecentMessages(contact.conversation_id, 10)
        const reply   = await getAIReply({ text, hasImage, imageBuffer, history })

        await db.saveMessage(contact.conversation_id, 'client', text || '[imagen]')
        await db.saveMessage(contact.conversation_id, 'ai', reply)
        await sock.sendMessage(msg.key.remoteJid, { text: reply })

        messageCount++
        console.log(`[${identifier}] → "${text.substring(0, 40)}" → "${reply.substring(0, 40)}"`)
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Dashboard-Key')
}

function checkAuth(req, res) {
  if (!DASHBOARD_SECRET) return true
  if (req.headers['x-dashboard-key'] === DASHBOARD_SECRET) return true
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Unauthorized' }))
  return false
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

  // ── Endpoints protegidos (Dashboard API) ─────────────────────────────

  if (!checkAuth(req, res)) return

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
