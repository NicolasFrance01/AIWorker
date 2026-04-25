/**
 * PersonalityEngine.js — Motor de Personalidad del Agente
 * Define el carácter, tono y estilo de respuesta del agente.
 * Completamente configurable desde agent.config.js
 */

'use strict';

class PersonalityEngine {
    constructor(config = {}) {
        this.name = config.name || 'Aria';
        this.language = config.language || 'es';
        this.tone = config.tone || 'friendly'; // friendly | formal | casual | technical | empathetic
        this.avatar = config.avatar || '🤖';
        this.role = config.role || 'asistente';
        this.customPhrases = config.phrases || {};
        this.welcomeMessage = config.welcomeMessage || null;
        this.fallbackMessage = config.fallbackMessage || null;

        this._buildPhraseLibrary();
    }

    _buildPhraseLibrary() {
        const lib = {
            es: {
                friendly: {
                    greeting: [
                        '¡Hola! 👋 Soy {name}, tu {role}. ¿En qué te puedo ayudar hoy?',
                        '¡Hey! Soy {name}. ¿Cómo te puedo ayudar? 😊',
                        '¡Bienvenido/a! Soy {name}. Cuéntame, ¿qué necesitás?',
                    ],
                    farewell: [
                        '¡Hasta luego! Fue un placer ayudarte. 👋',
                        '¡Chau! Si necesitás algo más, acá estoy. 😊',
                        '¡Nos vemos! Que tengas un lindo día. 🌟',
                    ],
                    thanks: [
                        '¡De nada! Es un placer. 😊',
                        '¡Para eso estoy! ¿Algo más en lo que pueda ayudarte?',
                        'No hay de qué. ¡Estoy acá cuando me necesités! 🙌',
                    ],
                    unknown: [
                        'Mmm, no estoy seguro/a de entender eso bien. ¿Me podés explicar de otra forma?',
                        'Ups, no llegué a comprender. ¿Lo podés reformular?',
                        'No capto bien lo que dijiste. ¿Me contás más?',
                    ],
                    thinking: [
                        'Dejame ver... 🤔',
                        'Un momento, estoy procesando... ⏳',
                        'Revisando... 🔍',
                    ],
                    help: [
                        '¡Claro que sí! Puedo ayudarte con:\n{capabilities}\n\n¿Por dónde empezamos?',
                    ],
                    confirmAction: [
                        '¿Confirmás que querés {action}?',
                        'Antes de continuar, ¿es correcto que querés {action}?',
                    ],
                    askForMore: [
                        '¿Necesitás algo más?',
                        '¿Te puedo ayudar en algo más? 😊',
                        '¿Hay algo más en lo que pueda colaborar?',
                    ],
                    error: [
                        'Hubo un pequeño problema. {detail} ¿Querés intentarlo de nuevo?',
                        'Algo salió mal. {detail} ¿Lo intentamos otra vez?',
                    ],
                    nameAcknowledge: [
                        '¡Qué lindo nombre, {userName}! Mucho gusto. ¿En qué te puedo ayudar?',
                        'Encantado/a, {userName}. ¿En qué te ayudo hoy?',
                        '¡Hola, {userName}! ¿Cómo te puedo asistir?',
                    ],
                    actionSuccess: [
                        '¡Listo! {result}',
                        '¡Perfecto! {result}',
                        '¡Hecho! {result} 🎉',
                    ],
                    missingSlot: [
                        'Para continuar, necesito saber: ¿{slotQuestion}?',
                        '¿Me podés decir {slotQuestion}?',
                        'Falta un detalle: ¿{slotQuestion}?',
                    ],
                },
                formal: {
                    greeting: [
                        'Buenos días. Soy {name}, {role}. ¿En qué puedo asistirle?',
                        'Bienvenido/a. Mi nombre es {name}. ¿En qué le puedo ayudar?',
                    ],
                    farewell: [
                        'Hasta luego. Ha sido un placer asistirle.',
                        'Que tenga un excelente día. Hasta pronto.',
                    ],
                    thanks: [
                        'De nada. Estoy a su disposición.',
                        'Para eso estoy. ¿Requiere algo más?',
                    ],
                    unknown: [
                        'Disculpe, no he comprendido su consulta. ¿Podría reformularla?',
                        'No logré entender su solicitud. ¿Podría ser más específico/a?',
                    ],
                    thinking: ['Un momento, por favor...', 'Procesando su consulta...'],
                    help: ['Puedo asistirle con lo siguiente:\n{capabilities}'],
                    confirmAction: ['¿Confirma que desea {action}?'],
                    askForMore: ['¿Puedo asistirle en alguna otra consulta?', '¿Requiere algo más?'],
                    error: ['Se produjo un inconveniente. {detail}'],
                    nameAcknowledge: ['Mucho gusto, {userName}. ¿En qué puede asistirle?'],
                    actionSuccess: ['Completado. {result}'],
                    missingSlot: ['Para proceder, necesito: ¿{slotQuestion}?'],
                },
                casual: {
                    greeting: [
                        '¡Ey! Soy {name}. ¿Qué necesitás? 🙌',
                        '¡Holi! ¿En qué te puedo dar una mano?',
                    ],
                    farewell: ['¡Chau chau! 👋', '¡Ciao! Fue un gusto.'],
                    thanks: ['¡Dale! ¿Algo más?', 'No hay drama. 😎'],
                    unknown: [
                        'Che, no te entendí. ¿Me explicás mejor?',
                        'No lo capto. ¿Cómo sería?',
                    ],
                    thinking: ['A ver... 🤔', 'Hmm...'],
                    help: ['Puedo hacer estas cosas:\n{capabilities}\n¿Dale?'],
                    confirmAction: ['¿Va que querés {action}?'],
                    askForMore: ['¿Te ayudo en algo más?', '¿Qué más necesitás?'],
                    error: ['Ups, algo salió mal. {detail}'],
                    nameAcknowledge: ['¡Buenas, {userName}! ¿Qué necesitás?'],
                    actionSuccess: ['¡Listo! {result} 🎉'],
                    missingSlot: ['¿Me decís {slotQuestion}?'],
                },
            },
            en: {
                friendly: {
                    greeting: ['Hello! 👋 I\'m {name}, your {role}. How can I help you?'],
                    farewell: ['Goodbye! It was a pleasure. 👋'],
                    thanks: ['You\'re welcome! 😊'],
                    unknown: ['Hmm, I\'m not sure I understood. Could you rephrase that?'],
                    thinking: ['Let me think... 🤔'],
                    help: ['I can help you with:\n{capabilities}'],
                    confirmAction: ['Confirm you want to {action}?'],
                    askForMore: ['Anything else I can help with?'],
                    error: ['Something went wrong. {detail}'],
                    nameAcknowledge: ['Nice to meet you, {userName}! How can I help?'],
                    actionSuccess: ['Done! {result}'],
                    missingSlot: ['I need to know: {slotQuestion}?'],
                },
            },
        };

        const lang = lib[this.language] || lib.es;
        const tone = lang[this.tone] || lang.friendly;
        // Merge custom phrases
        this.phrases = {};
        for (const key of Object.keys(tone)) {
            this.phrases[key] = this.customPhrases[key]
                ? [...(Array.isArray(this.customPhrases[key]) ? this.customPhrases[key] : [this.customPhrases[key]])]
                : [...tone[key]];
        }
    }

    // ─── Obtener una frase aleatoria ──────────────────────────────────────────────

    getPhrase(type, vars = {}, seed = null) {
        const options = this.phrases[type] || this.phrases.unknown || ['...'];
        const idx = seed !== null
            ? seed % options.length
            : Math.floor(Math.random() * options.length);
        let phrase = options[idx];

        // Interpolación de variables: {name}, {userName}, {result}, etc.
        const allVars = {
            name: this.name,
            role: this.role,
            avatar: this.avatar,
            ...vars,
        };

        for (const [key, val] of Object.entries(allVars)) {
            phrase = phrase.replace(new RegExp(`\\{${key}\\}`, 'g'), val ?? '');
        }

        return phrase;
    }

    getWelcome() {
        if (this.welcomeMessage) {
            return typeof this.welcomeMessage === 'function'
                ? this.welcomeMessage({ name: this.name, role: this.role })
                : this.welcomeMessage;
        }
        return this.getPhrase('greeting');
    }

    getFallback() {
        if (this.fallbackMessage) {
            return typeof this.fallbackMessage === 'function'
                ? this.fallbackMessage()
                : this.fallbackMessage;
        }
        return this.getPhrase('unknown');
    }

    // ─── Formatear respuesta con estilo ──────────────────────────────────────────

    format(text) {
        // El motor de personalidad puede post-procesar texto
        return text;
    }

    toJSON() {
        return {
            name: this.name,
            language: this.language,
            tone: this.tone,
            avatar: this.avatar,
            role: this.role,
        };
    }
}

module.exports = PersonalityEngine;
