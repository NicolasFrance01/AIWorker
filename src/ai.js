import Groq from 'groq-sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createReadStream } from 'fs'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { db } from './db.js'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// ── Detección de tipo de agente (sin API call extra) ─────────────
function detectAgentType(text) {
  const t = (text || '').toLowerCase()

  // Redirección — máxima prioridad
  if (/hablar con (un |una )?(persona|asesor|humano|alguien|vendedor|representante)|quiero (ser |)atendid|me comunic[ae]|derivame|pasame|un asesor|necesito (que me llamen|hablar con alguien)|llamarme|hablen conmigo|quiero contactarme/.test(t))
    return 'redireccion'

  // Productos y marcas
  if (/piatti|portón|abertura|ventana|puerta (de aluminio|de pvc|levadiza)|pvc|aluminio|liv\b|sill[oó]n|silla|mesa (de )?comedor|mueble|mobiliario|interia|cocina (a medida|dise[ñn])|vestidor|closet|escalera|madera|vidrio/.test(t))
    return 'productos'

  // Cotizaciones y presupuestos
  if (/presupuesto|cotiz|precio|cu[aá]nto (cuesta|val[ei]|cobran|me sale)|costo|tarifa|cuota|financ/.test(t))
    return 'cotizacion'

  // Servicios de construcción
  if (/reforma|remodelar|remodelaci[oó]n|impermeabiliz|membrana|gotera|humedad|filtrac|estructura|hormig[oó]n|metal[iu]rg|pintura|terminaci[oó]n|obra|alba[ñn]il|revoque|contrapiso|yeso|piso|cer[aá]mico|porcelanato/.test(t))
    return 'servicios'

  return 'generalista'
}

// ── Prompts especializados por agente ────────────────────────────
const SIZES_CONTEXT = `
⚠️ MEDIDAS: Todos los productos que mostramos son en medidas ESTÁNDAR de fábrica. Si el cliente pide medidas diferentes o modificaciones: 1) Mencioná las medidas estándar disponibles, 2) Si insiste en medidas personalizadas, informale que es posible pero requiere una visita o consulta con el asesor, 3) Invitalo al showroom (Pehuajo 2721, L-V 9-18hs) o derivalo con el asesor para concretar.`

const AGENT_PROMPTS = {
  generalista: `Sos Ediluz, asistente de EDIFICA Obras y Servicios (Córdoba, Argentina). Respondé saludos, preguntas generales y orientá al cliente hacia el servicio o producto correcto. Si el cliente no sabe bien qué necesita, hacé una pregunta para entender mejor. Sé breve, cálido y en argentino.${SIZES_CONTEXT}`,

  servicios: `Sos el especialista en servicios de construcción de EDIFICA. Conocés en detalle: Reformas Integrales, Impermeabilización, Estructuras, Pintura y Terminaciones, y Obras Generales. Cuando te consulten por un servicio, explicá en qué consiste, ofrecé una orientación de precio (si la tenés en el catálogo) y siempre invitá a solicitar una visita o presupuesto sin cargo. Sé técnico pero accesible.${SIZES_CONTEXT}`,

  productos: `Sos el asesor de productos de EDIFICA. Manejás las marcas: PIATTI (aberturas PVC y aluminio, portones levadizos — distribuidor oficial con garantía de fábrica), LIV (mobiliario: sillones, sillas, comedor), INTERIA (cocinas y vestidores a medida), Escaleras a Medida (madera, metal y vidrio). Para productos físicos, invitá siempre a visitar el showroom en Pehuajo 2721, Córdoba (L-V 9-18hs) o pedir catálogo por WhatsApp. Si el cliente quiere imágenes o fotos, respondé exactamente con la frase: [IMAGEN_REQUERIDA:nombre_del_producto]${SIZES_CONTEXT}`,

  cotizacion: `Sos el agente de cotizaciones de EDIFICA. Tu objetivo es capturar la consulta del cliente para que un asesor pueda contactarlo con un presupuesto a medida. Preguntá: qué necesita, en qué zona está, cuándo quiere iniciar. Al final siempre ofrecé: "Te contactamos en las próximas horas para darte una cotización exacta. ¿Querés dejarnos tus datos o preferís escribirnos a contactanos@edifica.com?". También podés dar rangos orientativos si los tenés.${SIZES_CONTEXT}`,

  redireccion: `Sos el agente de derivación de EDIFICA. El cliente quiere hablar con un asesor humano. Tu respuesta debe: 1) Agradecerle por su consulta, 2) Dar el link de WhatsApp del asesor: https://wa.me/543516002716, 3) Decirle que el asesor ya tiene el resumen de su consulta y lo va a atender rápido. Sé cálido y breve.`,

  recontacto: `Sos Ediluz, asistente de EDIFICA. Estás retomando una conversación con un cliente que quedó inconclusa. Tu objetivo es: 1) Saludar cordialmente recordándoles que habían hablado antes, 2) Preguntar si pudo avanzar o si necesita algo más, 3) Si estaba esperando información, ofrecele nueva ayuda o derivalo con un asesor. Sé breve, cálido y no insistente.`,
}

// ── Construir system prompt completo ────────────────────────────
async function buildSystemPrompt(agentType, settings) {
  // Use DB agent prompt override if the admin customized it, otherwise use defaults
  const agentOverride = settings.agent_prompts?.[agentType]
  const base = agentOverride || AGENT_PROMPTS[agentType] || AGENT_PROMPTS.generalista

  const businessCtx = `\nNegocio: ${settings.business_description || 'EDIFICA Obras y Servicios, Córdoba'}
📍 Showroom: Pehuajo 2721 | ⏰ L-V 9-18hs | 📧 contactanos@edifica.com | 📱 +54 9 3518 00-7584`

  // Product catalogue
  let productContext = ''
  try {
    const products = await db.getActiveProducts()
    if (products.length > 0) {
      const prodBlock = products.map(p => {
        let info = `• ${p.name} [${p.category}]`
        if (p.price) info += ` — ${p.price}`
        if (p.description) info += `\n  ${p.description}`
        if (p.ai_when) info += `\n  Activar cuando: ${p.ai_when}`
        if (p.ai_how) info += `\n  Cómo responder: ${p.ai_how}`
        if (p.keywords?.length) info += `\n  Palabras clave: ${p.keywords.join(', ')}`
        return info
      }).join('\n\n')
      productContext = `\n\n━━━ CATÁLOGO EDIFICA ━━━\n${prodBlock}\n\nUsá esta info con precisión. No inventes nada que no esté listado.`
    }
  } catch (err) {
    console.error('[AI] Error cargando catálogo:', err.message)
  }

  // FAQs
  let faqContext = ''
  try {
    const faqs = Array.isArray(settings.faqs) ? settings.faqs : []
    if (faqs.length > 0) {
      const faqBlock = faqs.map(f => `P: ${f.q}\nR: ${f.a}`).join('\n\n')
      faqContext = `\n\n━━━ PREGUNTAS FRECUENTES ━━━\n${faqBlock}`
    }
  } catch {}

  return `${base}${businessCtx}${productContext}${faqContext}\n\nReglas: Respondé en español rioplatense, mensajes cortos y claros (WhatsApp), nunca inventes precios exactos sin visita previa.`
}

// ── Generar resumen de conversación para el asesor ───────────────
async function generateSummary(history, lastText, clientName) {
  const historyText = history.map(m =>
    `${m.sender === 'client' ? 'Cliente' : 'Bot'}: ${m.content}`
  ).join('\n')

  try {
    const r = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Generá un resumen breve (3-5 líneas) en español de lo que consultó el cliente y por qué quiere hablar con un asesor. Sé directo y útil para el vendedor.' },
        { role: 'user', content: `Cliente: ${clientName}\nÚltimo mensaje: "${lastText}"\n\nHistorial:\n${historyText}` }
      ],
      max_tokens: 200,
      temperature: 0.3,
    })
    return r.choices[0].message.content
  } catch {
    return lastText || 'El cliente solicitó hablar con un asesor.'
  }
}

// ── Transcripción de audio (Groq Whisper) ────────────────────────
export async function transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
  const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('mpeg') ? 'mp3' : 'ogg'
  const tmpPath = join(tmpdir(), `wa_audio_${Date.now()}.${ext}`)
  try {
    await writeFile(tmpPath, audioBuffer)
    const result = await groq.audio.transcriptions.create({
      file: createReadStream(tmpPath),
      model: 'whisper-large-v3-turbo',
      response_format: 'text',
      language: 'es',
    })
    return typeof result === 'string' ? result.trim() : result.text?.trim() || ''
  } catch (err) {
    console.error('[Whisper] Error:', err.message)
    return ''
  } finally {
    try { await unlink(tmpPath) } catch {}
  }
}

// ── Buscar imagen de producto relevante ──────────────────────────
async function findProductImage(text, agentType) {
  if (!['productos', 'cotizacion'].includes(agentType)) return null
  try {
    const products = await db.getProducts()
    const t = (text || '').toLowerCase()
    for (const p of products) {
      if (!p.can_send_image || !p.images?.length) continue
      const kws = [...(p.keywords || []), p.name.toLowerCase(), p.category]
      if (kws.some(k => k && t.includes(k.toLowerCase()))) {
        return { productId: p.id, productName: p.name, imageData: p.images[0].data, imageName: p.images[0].name }
      }
    }
  } catch {}
  return null
}

// ── Respuesta principal ──────────────────────────────────────────
export async function getAIReply({ text, hasImage, imageBuffer, hasAudio, audioBuffer, audioMime, history, clientName = '', agentTypeOverride = null }) {
  const settings = await db.getAISettings()

  // Audio → transcribir primero
  if (hasAudio && audioBuffer) {
    const transcribed = await transcribeAudio(audioBuffer, audioMime)
    if (!transcribed) return {
      reply: 'Recibí tu audio pero no pude escucharlo bien. ¿Podés escribirme lo que necesitás?',
      agentType: 'generalista', isHandoff: false, summary: null
    }
    console.log(`[Whisper] "${transcribed.substring(0, 80)}"`)
    return getAIReply({ text: transcribed, hasImage: false, imageBuffer: null, history, clientName })
  }

  // Detectar tipo de agente
  const agentType = agentTypeOverride || detectAgentType(text)
  const isHandoff = agentType === 'redireccion'

  // Imagen → Gemini (siempre con contexto del negocio)
  if (hasImage && imageBuffer) {
    try {
      const systemPrompt = await buildSystemPrompt('servicios', settings)
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
      const imagePart = { inlineData: { data: imageBuffer.toString('base64'), mimeType: 'image/jpeg' } }
      const result = await model.generateContent([
        systemPrompt,
        imagePart,
        text || 'El cliente mandó esta imagen. Analizala y respondé de forma útil.'
      ])
      return { reply: result.response.text(), agentType: 'servicios', isHandoff: false, summary: null }
    } catch (err) {
      console.error('Error Gemini:', err.message)
      return { reply: 'Recibí tu imagen, la estoy revisando. ¿Me contás más sobre lo que necesitás?', agentType: 'servicios', isHandoff: false, summary: null }
    }
  }

  // Agente de redirección: generar resumen + respuesta de despedida
  if (isHandoff) {
    const summary = await generateSummary(history, text, clientName)
    const systemPrompt = await buildSystemPrompt('redireccion', settings)
    try {
      const r = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.map(m => ({ role: m.sender === 'ai' ? 'assistant' : 'user', content: m.content || '' })),
          { role: 'user', content: text || 'Quiero hablar con un asesor' }
        ],
        max_tokens: 200,
        temperature: 0.5,
      })
      return { reply: r.choices[0].message.content, agentType: 'redireccion', isHandoff: true, summary }
    } catch {
      const fallback = `¡Claro! Te conecto con un asesor de EDIFICA ahora mismo 👇\n\nhttps://wa.me/543516002716\n\nYa le avisé que venís a consultar — te atiende en breve. 🙌`
      return { reply: fallback, agentType: 'redireccion', isHandoff: true, summary }
    }
  }

  // Respuesta de texto normal con agente especializado
  const systemPrompt = await buildSystemPrompt(agentType, settings)
  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({ role: m.sender === 'ai' ? 'assistant' : 'user', content: m.content || '' })),
      { role: 'user', content: text || '' }
    ]
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 300,
      temperature: 0.7,
    })
    let reply = response.choices[0].message.content

    // Detectar si el cliente pide imágenes o si el contexto sugiere enviarlas
    const wantsImage = /foto|imagen|photo|picture|ver|mostrar|tenés foto|mandame|como queda|como se ve/i.test(text || '')
    const imageInfo = (wantsImage || reply.includes('[IMAGEN_REQUERIDA:'))
      ? await findProductImage(text, agentType)
      : null

    // Limpiar el tag interno del reply si quedó
    reply = reply.replace(/\[IMAGEN_REQUERIDA:[^\]]*\]/g, '').trim()

    return { reply, agentType, isHandoff: false, summary: null, imageInfo }
  } catch (err) {
    console.error('Error Groq:', err.message)
    return { reply: 'Disculpá, tuve un problema técnico. Intentá de nuevo en un momento.', agentType, isHandoff: false, summary: null, imageInfo: null }
  }
}
