/**
 * ActionRegistry.js — Registro de Acciones del Agente
 * Permite registrar funciones/acciones que el agente puede ejecutar.
 * Cada acción es un plugin que se puede añadir/quitar dinámicamente.
 */

'use strict';

class ActionRegistry {
    constructor() {
        this.actions = new Map();
    }

    /**
     * Registra una acción.
     * @param {Object} action
     * @param {string} action.name           - Identificador único (ej: 'searchProduct')
     * @param {string} action.description    - Descripción legible
     * @param {string[]} action.triggers     - Palabras/frases que activan esta acción
     * @param {string[]} [action.intents]    - Intenciones NLU que activan esta acción
     * @param {Object[]} [action.slots]      - Parámetros requeridos para ejecutar
     * @param {Function} action.handler      - async (params, context) => string|Object
     * @param {number}   [action.priority]   - Prioridad si varias acciones coinciden (default: 5)
     */
    register(action) {
        if (!action.name) throw new Error('Action must have a name');
        if (typeof action.handler !== 'function') throw new Error(`Action "${action.name}" must have a handler function`);

        const normalized = {
            name: action.name,
            description: action.description || action.name,
            triggers: (action.triggers || []).map(t => t.toLowerCase()),
            intents: action.intents || [],
            slots: (action.slots || []).map(s => ({
                name: s.name || s,
                question: s.question || `¿cuál es el/la ${s.name || s}?`,
                required: s.required !== false,
                type: s.type || 'string',
                entityKey: s.entityKey || null, // clave en NLU entities para autorellenar
            })),
            handler: action.handler,
            priority: action.priority || 5,
            examples: action.examples || [],
        };

        this.actions.set(action.name, normalized);
        return this;
    }

    /**
     * Registra múltiples acciones a la vez.
     */
    registerMany(actions = []) {
        for (const action of actions) this.register(action);
        return this;
    }

    /**
     * Obtiene una acción por nombre.
     */
    get(name) {
        return this.actions.get(name);
    }

    /**
     * Desregistra una acción.
     */
    unregister(name) {
        this.actions.delete(name);
        return this;
    }

    /**
     * Encuentra la mejor acción para el texto/intención dado.
     * Combina score por triggers (coincidencia en texto) + score por intención NLU.
     *
     * @param {string} text         - Texto original del usuario
     * @param {string} intent       - Intención detectada por NLU
     * @param {string[]} tokens     - Tokens del mensaje
     * @returns {{ action, score } | null}
     */
    findBestAction(text, intent, tokens = []) {
        const textLower = text.toLowerCase();
        let best = null;
        let bestScore = 0;

        for (const [, action] of this.actions) {
            let score = 0;

            // Score por intención
            if (action.intents.includes(intent)) {
                score += 10 * action.priority;
            }

            // Score por triggers (frase entera)
            for (const trigger of action.triggers) {
                if (textLower.includes(trigger)) {
                    score += trigger.split(' ').length * 5 * action.priority;
                }
            }

            // Score por tokens individuales
            for (const token of tokens) {
                for (const trigger of action.triggers) {
                    if (trigger === token) score += 2 * action.priority;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                best = { action, score };
            }
        }

        return best;
    }

    /**
     * Lista todas las acciones registradas (para mostrar al usuario en /help).
     */
    listActions() {
        return [...this.actions.values()].map(a => ({
            name: a.name,
            description: a.description,
            triggers: a.triggers.slice(0, 3),
        }));
    }

    /**
     * Compila el texto de capacidades para la frase de ayuda.
     */
    getCapabilitiesText() {
        const list = this.listActions();
        if (list.length === 0) return '(no hay acciones configuradas aún)';
        return list.map(a => `• ${a.description}`).join('\n');
    }

    get size() {
        return this.actions.size;
    }
}

module.exports = ActionRegistry;
