import Groq from 'groq-sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createReadStream } from 'fs'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { db } from './db.js'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

async function buildSystemPrompt(settings) {
  const base = `${settings.personality_prompt || 'Sos un asistente amable y profesional.'}

Negocio: ${settings.business_description || 'Asistente general'}

Reglas importantes:
- Respondé siempre en el mismo idioma que el cliente
- Sé breve y natural, como en una conversación de WhatsApp
- Si no sabés algo, decí que lo vas a consultar
- Nunca inventes precios ni información que no esté en tu catálogo
- Si el cliente quiere hablar con una persona, avisá que se lo vas a comunicar`

  try {
    const products = await db.getActiveProducts()
    if (products.length > 0) {
      const prodBlock = products.map(p => {
        let info = `• ${p.name} [${p.category}]`
        if (p.price) info += ` — Precio: ${p.price}`
        if (p.description) info += `\n  ${p.description}`
        if (p.availability) info += `\n  Disponibilidad: ${p.availability}`
        if (p.ai_when) info += `\n  Cuándo mencionarlo: ${p.ai_when}`
        if (p.ai_how) info += `\n  Cómo presentarlo: ${p.ai_how}`
        if (p.keywords?.length) info += `\n  Activa con palabras: ${p.keywords.join(', ')}`
        return info
      }).join('\n\n')

      return base + `\n\n━━━ CATÁLOGO DE PRODUCTOS Y SERVICIOS ━━━\n${prodBlock}\n\nUsá esta información para responder con precisión cuando el cliente pregunte por productos, precios o servicios. No inventes nada que no esté listado arriba.`
    }
  } catch (err) {
    console.error('[AI] Error cargando catálogo:', err.message)
  }

  return base
}

// ── Transcripción de audio con Groq Whisper ───────────────────────
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

// ── Respuesta principal ───────────────────────────────────────────
export async function getAIReply({ text, hasImage, imageBuffer, hasAudio, audioBuffer, audioMime, history }) {
  const settings = await db.getAISettings()
  const systemPrompt = await buildSystemPrompt(settings)

  // Audio → transcribir con Whisper, luego responder como texto
  if (hasAudio && audioBuffer) {
    const transcribed = await transcribeAudio(audioBuffer, audioMime)
    if (!transcribed) return 'Recibí tu audio pero no pude escucharlo bien. ¿Podés escribirme lo que necesitás?'
    console.log(`[Whisper] Transcripción: "${transcribed.substring(0, 80)}"`)
    return getAIReply({ text: transcribed, hasImage: false, imageBuffer: null, history })
  }

  // Imagen → Gemini Flash
  if (hasImage && imageBuffer) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
      const imagePart = { inlineData: { data: imageBuffer.toString('base64'), mimeType: 'image/jpeg' } }
      const result = await model.generateContent([
        systemPrompt,
        imagePart,
        text || 'El cliente mandó esta imagen. Analizala y respondé de forma útil según el contexto del negocio.'
      ])
      return result.response.text()
    } catch (err) {
      console.error('Error Gemini:', err.message)
      return 'Recibí tu imagen, la estoy revisando. En un momento te respondo.'
    }
  }

  // Texto → Groq Llama
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

    return response.choices[0].message.content
  } catch (err) {
    console.error('Error Groq:', err.message)
    return 'Disculpá, tuve un problema técnico. Intentá de nuevo en un momento.'
  }
}
