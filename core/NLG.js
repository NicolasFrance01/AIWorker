/**
 * NLG.js — Natural Language Generation
 * Genera respuestas naturales ricas en contexto, sin APIs de IA externas.
 */

'use strict';

class NLG {
    constructor({ personality, memory }) {
        this.personality = personality;
        this.memory = memory;
    }

    /**
     * Genera una respuesta según la intención y el contexto.
     * @param {string} intent
     * @param {Object} nluResult
     * @param {string} sessionId
     * @param {Object} [extraContext]
     * @returns {string}
     */
    generate(intent, nluResult, sessionId, extraContext = {}) {
        const user = this.memory.getUser(sessionId);
        const userName = user.name || null;
        const sentiment = nluResult.sentiment;
        const entities = nluResult.entities || {};

        const vars = {
            userName: userName || 'amigo/a',
            ...entities,
            ...extraContext,
        };

        // Adaptar según sentimiento negativo
        if (sentiment === 'negative' && !['complain', 'farewell'].includes(intent)) {
            return this._empathyWrap(this._responseForIntent(intent, vars, sessionId), vars);
        }

        return this._responseForIntent(intent, vars, sessionId);
    }

    _responseForIntent(intent, vars, sessionId) {
        const p = this.personality;
        const user = this.memory.getUser(sessionId);
        const userName = user.name || null;
        const turnCount = this.memory.getSession(sessionId).turnCount;

        switch (intent) {
            case 'greeting':
                if (userName) {
                    // Ya conocemos el nombre
                    return p.getPhrase('greeting').replace(
                        /hola[^!]*!/i,
                        `¡Hola de nuevo, ${userName}!`
                    );
                }
                return p.getPhrase('greeting');

            case 'farewell':
                return userName
                    ? p.getPhrase('farewell').replace(/!/g, `, ${userName}!`).replace(`${userName}!${userName}!`, `${userName}!`)
                    : p.getPhrase('farewell');

            case 'thanks':
                return p.getPhrase('thanks');

            case 'affirmation':
                // Afirmación sin acción pendiente = responder positivamente
                return this._pickFromList([
                    '¡Genial! ¿En qué más puedo ayudarte?',
                    '¡Perfecto! ¿Qué más necesitás?',
                    '¡Entendido! ¿Algo más?',
                ], turnCount);

            case 'negation':
                return this._pickFromList([
                    'Está bien, sin problema. ¿Hay algo más en lo que te pueda ayudar?',
                    'Entendido. ¿Necesitás algo más?',
                    'Ok, cuando quieras. ¿Te puedo asistir en otra cosa?',
                ], turnCount);

            case 'help': {
                const capabilities = this.memory.getWorking(sessionId, '_capabilities') || '';
                return p.getPhrase('help', { capabilities });
            }

            case 'name_introduction': {
                const name = vars.name;
                if (name) {
                    this.memory.setUser(sessionId, { name });
                    return p.getPhrase('nameAcknowledge', { userName: name });
                }
                return `¡Hola! ¿Cómo te llamás?`;
            }

            case 'question':
                return this._handleQuestion(vars, sessionId);

            case 'complain':
                return this._pickFromList([
                    `Lamento que estés teniendo problemas. Haceme saber el detalle así te ayudo mejor.`,
                    `Entiendo tu frustración. ¿Me contás más sobre el inconveniente para poder ayudarte?`,
                    `Disculpá los inconvenientes. ¿Qué está pasando exactamente?`,
                ], vars);

            case 'info':
                return `Dame más detalles sobre qué información buscás y te ayudo con gusto.`;

            case 'search':
            case 'buy':
                // Estas deberían ser manejadas por acciones específicas
                // Si llegamos acá es porque no hay acción registrada
                return `Entiendo que querés ${intent === 'buy' ? 'comprar algo' : 'buscar algo'}. ¿Podés ser más específico/a?`;

            case 'unknown':
            default:
                return p.getFallback();
        }
    }

    _handleQuestion(vars, sessionId) {
        const raw = vars.raw || '';
        // Respuestas básicas a preguntas comunes
        const lowerRaw = raw.toLowerCase();

        if (lowerRaw.includes('cómo') && lowerRaw.includes('llam')) {
            return `Me llamo ${this.personality.name}. ${this.personality.avatar} ¿Y vos?`;
        }
        if (lowerRaw.includes('qué sos') || lowerRaw.includes('quién sos') || lowerRaw.includes('quien eres')) {
            return `Soy ${this.personality.name}, un agente conversacional inteligente. Puedo ayudarte con tareas, responder preguntas y más. ¿En qué te puedo asistir?`;
        }
        if (lowerRaw.includes('cómo funciona') || lowerRaw.includes('como funciona')) {
            return `Simplemente escribime lo que necesitás y haré lo posible por ayudarte. Podés pedirme información, realizar acciones o simplemente charlar.`;
        }

        return `Interesante pregunta. Dame un poco más de contexto para responderte mejor.`;
    }

    _empathyWrap(response, vars) {
        const empathy = this._pickFromList([
            'Entiendo que puede ser frustrante. ',
            'Lamento el inconveniente. ',
            'Estoy aquí para ayudarte. ',
        ], Math.random());
        return empathy + response;
    }

    _pickFromList(list, seed) {
        if (!Array.isArray(list)) return list;
        const idx = typeof seed === 'number'
            ? Math.floor(Math.abs(seed)) % list.length
            : Math.floor(Math.random() * list.length);
        return list[idx];
    }

    /**
     * Formatea datos estructurados en texto legible.
     */
    formatData(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        if (Array.isArray(data)) {
            if (data.length === 0) return 'No encontré resultados.';
            return data.map((item, i) => {
                if (typeof item === 'string') return `• ${item}`;
                if (typeof item === 'object') {
                    const parts = Object.entries(item)
                        .map(([k, v]) => `**${k}**: ${v}`)
                        .join(' | ');
                    return `${i + 1}. ${parts}`;
                }
                return String(item);
            }).join('\n');
        }
        if (typeof data === 'object') {
            return Object.entries(data)
                .map(([k, v]) => `• **${k}**: ${v}`)
                .join('\n');
        }
        return String(data);
    }
}

module.exports = NLG;
