/**
 * NLU.js — Natural Language Understanding
 * Comprende el texto del usuario: intenciones, entidades, sentimiento.
 * 100% programático, sin APIs de IA externas.
 */

'use strict';

class NLU {
    constructor(config = {}) {
        this.language = config.language || 'es';
        this.customIntents = config.intents || [];
        this.customEntities = config.entities || [];
        this._buildIntentMap();
        this._buildEntityPatterns();
    }

    // ─── Intenciones base según idioma ───────────────────────────────────────────

    _buildIntentMap() {
        const base = {
            es: [
                {
                    name: 'greeting',
                    priority: 10,
                    patterns: ['hola', 'buenas', 'buenos días', 'buen dia', 'buenas tardes',
                        'buenas noches', 'hey', 'holi', 'qué tal', 'como estas',
                        'cómo estás', 'saludos', 'ola', 'hello', 'hi'],
                },
                {
                    name: 'farewell',
                    priority: 10,
                    patterns: ['adiós', 'adios', 'chau', 'hasta luego', 'nos vemos',
                        'hasta pronto', 'bye', 'hasta mañana', 'me voy', 'ciao'],
                },
                {
                    name: 'thanks',
                    priority: 9,
                    patterns: ['gracias', 'muchas gracias', 'te agradezco', 'thank you',
                        'thanks', 'mil gracias', 'muy amable', 'excelente gracias'],
                },
                {
                    name: 'affirmation',
                    priority: 8,
                    patterns: ['si', 'sí', 'claro', 'por supuesto', 'dale', 'ok', 'okay',
                        'de acuerdo', 'correcto', 'exacto', 'perfecto', 'va', 'bueno',
                        'confirmo', 'confirmar', 'acepto'],
                },
                {
                    name: 'negation',
                    priority: 8,
                    patterns: ['no', 'nope', 'nel', 'para nada', 'de ninguna manera',
                        'no quiero', 'no gracias', 'cancela', 'cancelar', 'olvídalo'],
                },
                {
                    name: 'help',
                    priority: 7,
                    patterns: ['ayuda', 'ayudame', 'ayúdame', 'help', 'no entiendo',
                        'qué puedes hacer', 'que puedes hacer', 'cómo funciona',
                        'como funciona', 'qué haces', 'para qué sirves', 'opciones',
                        'menú', 'menu', 'comandos'],
                },
                {
                    name: 'question',
                    priority: 6,
                    patterns: ['qué', 'que', 'cómo', 'como', 'cuándo', 'cuando',
                        'dónde', 'donde', 'cuánto', 'cuanto', 'cuál', 'cual',
                        'quién', 'quien', 'por qué', 'por que'],
                },
                {
                    name: 'name_introduction',
                    priority: 9,
                    patterns: ['me llamo', 'mi nombre es', 'soy', 'me pueden llamar',
                        'me llaman', 'llámame', 'llamame'],
                },
                {
                    name: 'complain',
                    priority: 7,
                    patterns: ['no funciona', 'está mal', 'esta mal', 'error', 'problema',
                        'falla', 'no sirve', 'queja', 'mal servicio', 'pesimo'],
                },
                {
                    name: 'search',
                    priority: 6,
                    patterns: ['buscar', 'busca', 'busco', 'quiero ver', 'mostrar',
                        'muestra', 'ver', 'encontrar', 'necesito', 'quiero'],
                },
                {
                    name: 'buy',
                    priority: 6,
                    patterns: ['comprar', 'compra', 'quiero comprar', 'agregar al carrito',
                        'añadir', 'pedido', 'ordenar', 'precio', 'cuánto cuesta',
                        'cuanto vale', 'cómo compro'],
                },
                {
                    name: 'info',
                    priority: 5,
                    patterns: ['información', 'informacion', 'info', 'dime', 'cuéntame',
                        'explícame', 'explicame', 'detalles', 'más sobre', 'mas sobre'],
                },
                {
                    name: 'unknown',
                    priority: 0,
                    patterns: [],
                },
            ],
            en: [
                { name: 'greeting', priority: 10, patterns: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'greetings'] },
                { name: 'farewell', priority: 10, patterns: ['bye', 'goodbye', 'see you', 'later', 'farewell'] },
                { name: 'thanks', priority: 9, patterns: ['thanks', 'thank you', 'appreciate it', 'thx'] },
                { name: 'affirmation', priority: 8, patterns: ['yes', 'yep', 'sure', 'ok', 'okay', 'correct', 'right', 'confirm'] },
                { name: 'negation', priority: 8, patterns: ['no', 'nope', 'cancel', 'stop', 'never mind'] },
                { name: 'help', priority: 7, patterns: ['help', 'what can you do', 'how does this work', 'options', 'menu'] },
                { name: 'question', priority: 6, patterns: ['what', 'how', 'when', 'where', 'why', 'who', 'which'] },
                { name: 'search', priority: 6, patterns: ['search', 'find', 'look for', 'show me', 'get'] },
                { name: 'buy', priority: 6, patterns: ['buy', 'purchase', 'order', 'price', 'cost', 'how much'] },
                { name: 'unknown', priority: 0, patterns: [] },
            ],
        };

        this.intents = [
            ...(base[this.language] || base.es),
            ...this.customIntents,
        ];
    }

    _buildEntityPatterns() {
        this.entityPatterns = [
            { name: 'number', regex: /\b\d+([.,]\d+)?\b/g },
            { name: 'email', regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}\b/gi },
            { name: 'phone', regex: /\b(\+?\d[\d\s\-().]{6,}\d)\b/g },
            { name: 'date', regex: /\b(\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?|\d{4}-\d{2}-\d{2}|hoy|mañana|ayer|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/gi },
            { name: 'time', regex: /\b(\d{1,2}:\d{2}(:\d{2})?(\s?(am|pm|hs|h))?\b|\d{1,2}\s?(am|pm|hs))\b/gi },
            { name: 'money', regex: /\$\s?\d+([.,]\d+)?|\d+([.,]\d+)?\s?(pesos?|dolares?|euros?|usd|ars|eur)/gi },
            // Extraer nombre propio: solo con frases inequívocas (NO 'soy' — muy ambiguo)
            // Captura 1 palabra, o 2 si la segunda empieza en mayúscula (apellido real)
            { name: 'name', regex: /(?:me llamo|mi nombre es|llámame|llamame|me llaman|pueden llamarme)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/i },
            ...this.customEntities,
        ];
    }

    // ─── Tokenización ─────────────────────────────────────────────────────────────

    tokenize(text) {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // quitar acentos para comparación
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 0);
    }

    // ─── Detect Intent (TF-IDF simplificado + cosine similarity) ─────────────────

    detectIntent(text) {
        const tokens = this.tokenize(text);
        const scores = [];

        for (const intent of this.intents) {
            if (intent.name === 'unknown') continue;

            let score = 0;
            let matches = 0;

            for (const pattern of intent.patterns) {
                const patternTokens = this.tokenize(pattern);
                // Coincidencia exacta de frase multi-palabra
                if (text.toLowerCase().includes(pattern.toLowerCase())) {
                    score += patternTokens.length * 3 * intent.priority;
                    matches++;
                    continue;
                }
                // Coincidencia parcial por tokens
                for (const pToken of patternTokens) {
                    if (tokens.includes(pToken)) {
                        score += (1 / patternTokens.length) * intent.priority;
                        matches++;
                    }
                }
            }

            if (score > 0) {
                scores.push({ intent: intent.name, score, matches });
            }
        }

        if (scores.length === 0) {
            return { intent: 'unknown', confidence: 0.1, allScores: [] };
        }

        scores.sort((a, b) => b.score - a.score);
        const best = scores[0];
        const maxPossible = best.score * 1.5;
        const confidence = Math.min(best.score / maxPossible, 0.99);

        return {
            intent: best.intent,
            confidence: parseFloat(confidence.toFixed(2)),
            allScores: scores.slice(0, 3),
        };
    }

    // ─── Extracción de entidades ─────────────────────────────────────────────────

    extractEntities(text) {
        const entities = {};

        for (const ep of this.entityPatterns) {
            const isGlobal = ep.regex.flags.includes('g');
            const regex = new RegExp(ep.regex.source, ep.regex.flags);

            if (isGlobal) {
                // matchAll requires global flag
                const matches = [...text.matchAll(regex)];
                if (matches.length > 0) {
                    entities[ep.name] = matches.map(m => m[0].trim());
                    if (entities[ep.name].length === 1) {
                        entities[ep.name] = entities[ep.name][0];
                    }
                }
            } else {
                // Non-global regex — use exec for single capture (e.g. 'name')
                const m = regex.exec(text);
                if (m) {
                    entities[ep.name] = (m[1] || m[0]).trim();
                }
            }
        }

        return entities;
    }

    // ─── Análisis de sentimiento ─────────────────────────────────────────────────

    analyzeSentiment(text) {
        const normalized = text.toLowerCase();

        const positive = ['bien', 'bueno', 'excelente', 'genial', 'perfecto', 'gracias',
            'feliz', 'contento', 'súper', 'fantástico', 'increíble', 'me gusta', 'love',
            'great', 'good', 'amazing', 'happy', 'thanks'];

        const negative = ['mal', 'malo', 'terrible', 'horrible', 'pésimo', 'odio',
            'no funciona', 'error', 'problema', 'falla', 'molesto', 'enojado', 'nunca',
            'bad', 'hate', 'wrong', 'broken', 'fail', 'awful'];

        let posScore = 0;
        let negScore = 0;

        for (const w of positive) if (normalized.includes(w)) posScore++;
        for (const w of negative) if (normalized.includes(w)) negScore++;

        if (posScore > negScore) return 'positive';
        if (negScore > posScore) return 'negative';
        return 'neutral';
    }

    // ─── Análisis completo ───────────────────────────────────────────────────────

    analyze(text) {
        if (!text || typeof text !== 'string' || text.trim() === '') {
            return {
                raw: text,
                tokens: [],
                intent: 'unknown',
                confidence: 0,
                entities: {},
                sentiment: 'neutral',
            };
        }

        const { intent, confidence, allScores } = this.detectIntent(text);
        const entities = this.extractEntities(text);
        const sentiment = this.analyzeSentiment(text);
        const tokens = this.tokenize(text);

        return {
            raw: text,
            tokens,
            intent,
            confidence,
            allScores,
            entities,
            sentiment,
        };
    }
}

module.exports = NLU;
