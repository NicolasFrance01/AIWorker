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

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: { level: 'silent', log: () => {}, info: () => {}, warn: () => {}, error: console.error, trace: () => {}, debug: () => {}, child: () => ({ level: 'silent', log: () => {}, info: () => {}, warn: () => {}, error: console.error, trace: () => {}, debug: () => {} }) }
  })

  setAdminSocket(sock)

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      latestQR = qr
      console.log('Nuevo QR generado. Escanealo en: /qr')
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut

      restartCount++
      console.log(`Conexión cerrada. Código: ${code}. Reconectando: ${shouldReconnect}`)

      if (shouldReconnect) {
        console.log('Reconectando en 5 segundos...')
        setTimeout(connectToWhatsApp, 5000)
      } else {
        await sendAdminAlert(
          'Sesión cerrada de WhatsApp.\nNecesitás escanear el QR de nuevo en los logs de Render.'
        )
        console.log('Sesión cerrada. Necesita nuevo QR.')
      }
    }

    if (connection === 'open') {
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
      if (msg.key.fromMe) return
      if (!msg.message) return

      const jid = msg.key.remoteJid || ''
      if (!jid || jid.endsWith('@g.us')) return  // ignorar grupos

      const phone = jid.replace('@s.whatsapp.net', '').replace('@lid', '')
      console.log(`[MSG] jid=${jid} phone=${phone} name=${msg.pushName}`)

      const ADMIN = process.env.ADMIN_PHONE || '5493516002716'
      if (phone === ADMIN) return

      const ALLOWED = (process.env.ALLOWED_PHONES || '29463626682562').split(',').map(p => p.trim())
      if (!ALLOWED.includes(phone)) {
        console.log(`[BLOQUEADO] ${phone} (${msg.pushName})`)
        return
      }

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''

      const hasImage = !!msg.message.imageMessage
      let imageBuffer = null

      try {
        if (hasImage) {
          imageBuffer = await downloadMediaMessage(msg, 'buffer', {})
        }

        const contact = await db.upsertContact(phone, msg.pushName || '')
        const history = await db.getRecentMessages(contact.conversation_id, 10)

        const reply = await getAIReply({ text, hasImage, imageBuffer, history })

        await db.saveMessage(contact.conversation_id, 'client', text || '[imagen]')
        await db.saveMessage(contact.conversation_id, 'ai', reply)

        await sock.sendMessage(msg.key.remoteJid, { text: reply })

        messageCount++
        console.log(`[${phone}] → "${text.substring(0, 40)}" → "${reply.substring(0, 40)}"`)

      } catch (err) {
        console.error(`Error procesando mensaje de ${phone}:`, err.message)
      }
    }
  })

  return sock
}

// ── Health check + QR endpoint ────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    const uptimeMin = Math.floor((Date.now() - startTime) / 1000 / 60)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      uptime_minutes: uptimeMin,
      messages_processed: messageCount,
      restarts: restartCount,
      timestamp: new Date().toISOString()
    }))
  } else if (req.url === '/qr') {
    if (!latestQR) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<h2>No hay QR disponible — WhatsApp ya está conectado o esperando reconexión.</h2>')
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
  } else {
    res.writeHead(404)
    res.end()
  }
})

server.listen(process.env.PORT || 3000, () => {
  console.log(`Health check corriendo en puerto ${process.env.PORT || 3000}`)
})

// ── Reporte diario automático a las 9am Argentina ────────────────────
cron.schedule('0 12 * * *', async () => {  // 12 UTC = 9am ARG
  try {
    const stats = await db.getStats()
    const uptimeHrs = Math.floor((Date.now() - startTime) / 1000 / 60 / 60)

    await sendAdminAlert(
      `*Reporte diario*\n` +
      `Mensajes hoy: ${stats.messages_24h}\n` +
      `Contactos totales: ${stats.total_contacts}\n` +
      `Uptime: ${uptimeHrs}hs\n` +
      `Reinicios: ${restartCount}\n` +
      `Estado: funcionando`
    )
  } catch (err) {
    console.error('Error enviando reporte diario:', err.message)
  }
}, { timezone: 'America/Argentina/Buenos_Aires' })

// ── Alerta si RAM supera 70% ──────────────────────────────────────────
setInterval(async () => {
  const used = process.memoryUsage().heapUsed / 1024 / 1024
  const total = 512 // MB disponibles en Render free
  const pct = Math.round((used / total) * 100)

  if (pct > 70) {
    await sendAdminAlert(
      `*Alerta de RAM*\n` +
      `Uso: ${used.toFixed(0)}MB / ${total}MB (${pct}%)\n` +
      `Puede afectar el rendimiento. Considera el plan pago.`
    )
  }
}, 1000 * 60 * 30) // cada 30 minutos

// ── Arrancar ──────────────────────────────────────────────────────────
console.log('Iniciando worker de WhatsApp...')
connectToWhatsApp()
