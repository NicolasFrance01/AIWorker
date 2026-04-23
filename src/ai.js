import Groq from 'groq-sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { db } from './db.js'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

export async function getAIReply({ text, hasImage, imageBuffer, history }) {
  const settings = await db.getAISettings()

  const systemPrompt = `${settings.personality_prompt || 'Sos un asistente amable y profesional.'}

Negocio: ${settings.business_description || 'Asistente general'}

Reglas importantes:
- Respondé siempre en el mismo idioma que el cliente
- Sé breve y natural, como en una conversación de WhatsApp
- Si no sabés algo, decí que lo vas a consultar
- Nunca inventes precios ni información de productos
- Si el cliente quiere hablar con una persona, avisá que se lo vas a comunicar`

  // Si hay imagen, usamos Gemini Flash (gratis)
  if (hasImage && imageBuffer) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
      const imagePart = {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: 'image/jpeg'
        }
      }
      const result = await model.generateContent([
        systemPrompt,
        imagePart,
        text || 'El cliente mandó esta imagen. Respondé de forma útil según el contexto del negocio.'
      ])
      return result.response.text()
    } catch (err) {
      console.error('Error Gemini:', err.message)
      return 'Recibí tu imagen, la estoy revisando. En un momento te respondo.'
    }
  }

  // Solo texto: usamos Groq con Llama (gratis)
  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({
        role: m.sender === 'ai' ? 'assistant' : 'user',
        content: m.content || ''
      })),
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
