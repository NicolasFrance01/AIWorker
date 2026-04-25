/**
 * core/LLMEngine.js
 * Motor LLM con Ollama — Inteligencia Conversacional Real
 *
 * Usa Ollama para razonamiento y conversación libre.
 * Integra tool-calling nativo para ejecutar acciones registradas.
 * Si Ollama no está disponible, informa el error con claridad.
 */

'use strict';

const { Ollama } = require('ollama');

class LLMEngine {
    constructor(config = {}) {
        this.config = config;
        this.model = config.model || 'llama3.2';
        this.host = config.host || 'http://127.0.0.1:11434';
        this.available = false;
        this.checkedAt = 0;

        this.ollama = new Ollama({ host: this.host });
    }

    // ─── Chequear si Ollama está corriendo ───────────────────────────────────────

    async checkAvailability() {
        // Cachear resultado por 30 segundos
        if (Date.now() - this.checkedAt < 30_000) return this.available;

        try {
            const list = await this.ollama.list();
            this.available = Array.isArray(list.models);
            this.checkedAt = Date.now();

            if (this.available && list.models.length > 0) {
                const modelNames = list.models.map(m => m.name);
                // Ajustar el modelo al disponible más cercano
                const exact = modelNames.find(n => n.startsWith(this.model));
                if (exact) this.model = exact;
                else this.model = modelNames[0]; // usar el primero disponible
                console.log(`[LLM] Ollama disponible. Modelo: ${this.model}`);
            } else if (this.available) {
                console.warn('[LLM] Ollama está corriendo pero no tiene modelos. Corré: ollama pull llama3.2');
                this.available = false;
            }
        } catch {
            this.available = false;
            this.checkedAt = Date.now();
        }

        return this.available;
    }

    // ─── Construir el system prompt ───────────────────────────────────────────────

    buildSystemPrompt(personality, actions = []) {
        const { name, tone, role, language } = personality;
        const lang = language === 'es' ? 'español rioplatense' : 'English';

        const toneDesc = {
            friendly: 'amigable, cálido, empático y cercano. Usás el vos (tuteo rioplatense). Expresás emociones genuinas.',
            formal: 'formal, profesional y cortés. Hablás de usted cuando corresponde.',
            casual: 'casual, relajado y divertido. Usás el vos. Podés usar jerga coloquial.',
            technical: 'técnico y preciso. Explicás detalles sin simplificar en exceso.',
        }[tone] || 'natural y útil';

        let systemPrompt = `Sos ${name}, un ${role}. Tu estilo es ${toneDesc}
Respondés siempre en ${lang}. Sos genuino, interesante y recordás el contexto de la conversación.
Nunca rompés personaje ni mencionás que sos un modelo de IA o LLM — simplemente sos ${name}.
`;

        if (actions.length > 0) {
            systemPrompt += `\nTenés las siguientes capacidades especiales (tools) que podés usar cuando el usuario lo necesite:\n`;
            for (const a of actions) {
                systemPrompt += `- ${a.name}: ${a.description}\n`;
            }
            systemPrompt += `\nCuando quieras usar una de ellas, el sistema te lo va a pedir con el mecanismo de tools. Respondé naturalmente primero y dejá que el sistema maneje la ejecución.\n`;
        }

        return systemPrompt;
    }

    // ─── Convertir acciones registradas al formato tools de Ollama ───────────────

    buildTools(actions = []) {
        return actions.map(action => ({
            type: 'function',
            function: {
                name: action.name,
                description: action.description,
                parameters: {
                    type: 'object',
                    properties: Object.fromEntries(
                        (action.slots || []).map(slot => [
                            slot.name,
                            {
                                type: slot.type === 'number' ? 'number' : 'string',
                                description: slot.question || slot.name,
                            },
                        ])
                    ),
                    required: (action.slots || [])
                        .filter(s => s.required)
                        .map(s => s.name),
                },
            },
        }));
    }

    // ─── Chat principal ───────────────────────────────────────────────────────────

    /**
     * @param {Array}  history    - [{role: 'user'|'assistant', content: string}]
     * @param {string} userMsg    - Último mensaje del usuario
     * @param {Object} personality - Config de personalidad del agente
     * @param {Array}  actions    - Acciones registradas [{name, description, slots, handler}]
     * @returns {Promise<{text: string, toolCall?: {name: string, params: object}}>}
     */
    async chat(history, userMsg, personality, actions = []) {
        const isAvailable = await this.checkAvailability();
        if (!isAvailable) {
            throw new Error('OLLAMA_NOT_AVAILABLE');
        }

        const systemPrompt = this.buildSystemPrompt(personality, actions);
        const tools = this.buildTools(actions);

        // Construir historial en formato Ollama
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: userMsg },
        ];

        const response = await this.ollama.chat({
            model: this.model,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            options: {
                temperature: 0.75,
                num_ctx: 4096,
            },
        });

        const msg = response.message;

        // El LLM quiere llamar a un tool/acción
        if (msg.tool_calls && msg.tool_calls.length > 0) {
            const call = msg.tool_calls[0];
            return {
                text: msg.content || '',
                toolCall: {
                    name: call.function.name,
                    params: call.function.arguments || {},
                },
            };
        }

        // Respuesta de texto libre
        return {
            text: msg.content || '',
            toolCall: null,
        };
    }

    // ─── Chat con resultado de tool (segunda vuelta) ──────────────────────────────

    async chatWithToolResult(history, userMsg, personality, toolName, toolResult) {
        const systemPrompt = this.buildSystemPrompt(personality, []);
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: userMsg },
            {
                role: 'tool',
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            },
        ];

        const response = await this.ollama.chat({
            model: this.model,
            messages,
            options: { temperature: 0.75 },
        });

        return response.message.content || '';
    }

    // ─── Getter de estado ─────────────────────────────────────────────────────────

    getStatus() {
        return {
            available: this.available,
            model: this.model,
            host: this.host,
        };
    }
}

module.exports = LLMEngine;
