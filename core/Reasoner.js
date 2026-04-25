/**
 * Reasoner.js — Motor de Razonamiento con Reglas
 * Permite definir reglas IF-condición THEN-acción aplicadas sobre el contexto.
 */

'use strict';

class Reasoner {
    constructor(config = {}) {
        this.rules = [];
        this._loadDefaultRules();
        if (config.rules) {
            for (const rule of config.rules) this.addRule(rule);
        }
    }

    /**
     * Añade una regla de razonamiento.
     * @param {Object} rule
     * @param {string}   rule.name        - Nombre de la regla
     * @param {number}   [rule.priority]  - Prioridad (mayor = más prioritaria)
     * @param {Function} rule.condition   - (nluResult, context) => boolean
     * @param {Function} rule.action      - (nluResult, context) => { override?, response? }
     */
    addRule(rule) {
        this.rules.push({
            name: rule.name || 'unnamed',
            priority: rule.priority || 5,
            condition: rule.condition,
            action: rule.action,
        });
        // Ordenar por prioridad descendente
        this.rules.sort((a, b) => b.priority - a.priority);
        return this;
    }

    /**
     * Aplica las reglas sobre el resultado NLU y contexto de sesión.
     * Retorna el primer match que genera override, o null.
     */
    apply(nluResult, sessionContext) {
        for (const rule of this.rules) {
            try {
                if (rule.condition(nluResult, sessionContext)) {
                    const result = rule.action(nluResult, sessionContext);
                    if (result) {
                        return { ...result, appliedRule: rule.name };
                    }
                }
            } catch (e) {
                // Reglas que fallan no bloquean el flujo
            }
        }
        return null;
    }

    /**
     * Reglas incorporadas por defecto.
     */
    _loadDefaultRules() {
        // Regla: saludo explosivo al primer turno
        this.addRule({
            name: 'first_interaction_greeting',
            priority: 9,
            condition: (nlu, ctx) => nlu.intent === 'greeting' && ctx.turnCount <= 1,
            action: (nlu, ctx) => null, // Dejar que NLG maneje el saludo inicial
        });

        // Regla: detectar "me llamo / mi nombre es X" — extracción limpia de NLU
        this.addRule({
            name: 'detect_name_in_any_message',
            priority: 8,
            condition: (nlu, ctx) => !!nlu.entities.name && !ctx.user.name,
            action: (nlu, ctx) => ({
                override: true,
                intent: 'name_introduction',
                extractedName: nlu.entities.name,
            }),
        });

        // Regla: detectar "soy [Nombre]" — patrón separado para evitar capturas erróneas
        // Funciona con texto en minúsculas (como escribe la mayoría de usuarios)
        this.addRule({
            name: 'detect_soy_nombre',
            priority: 7,
            condition: (nlu, ctx) => {
                if (ctx.user.name) return false;
                // Captura la primera palabra alfabética después de "soy"
                const match = nlu.raw.match(/\bsoy\s+([a-záéíóúñA-ZÁÉÍÓÚÑ]+)/i);
                if (!match) return false;
                // Ignorar palabras funcionales / adjetivos comunes que no son nombres
                const notNames = [
                    'un', 'una', 'el', 'la', 'los', 'las', 'de', 'del', 'tu', 'su',
                    'muy', 'bien', 'mal', 'feliz', 'contento', 'nuevo', 'nueva',
                    'tu', 'su', 'yo', 'yo', 'su', 'hay', 'asi', 'así',
                    'programador', 'developer', 'diseñador',
                ];
                return !notNames.includes(match[1].toLowerCase());
            },
            action: (nlu, ctx) => {
                // Solo capturar UNA palabra (primer nombre) para evitar capturas erróneas
                const match = nlu.raw.match(/\bsoy\s+([a-záéíóúñA-ZÁÉÍÓÚÑ]+)/i);
                if (!match) return null;
                // Title-case
                const name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
                return {
                    override: true,
                    intent: 'name_introduction',
                    extractedName: name,
                };
            },
        });

        // Regla: si el usuario repite la misma intención 3 veces sin resolución
        this.addRule({
            name: 'repeated_intent_detection',
            priority: 7,
            condition: (nlu, ctx) => {
                if (!ctx.history || ctx.history.length < 4) return false;
                const recent = ctx.history.slice(-4).filter(h => h.role === 'user');
                const intents = recent.map(h => h.intent).filter(Boolean);
                return intents.length >= 2 && intents.every(i => i === nlu.intent) && nlu.intent === 'unknown';
            },
            action: () => ({
                override: false,
                addPrefix: '¿Podés intentar describirlo de otra manera? ',
            }),
        });

        // Regla: mensaje muy corto (1-2 tokens) → pedir más contexto
        this.addRule({
            name: 'too_short_message',
            priority: 3,
            condition: (nlu, ctx) =>
                nlu.tokens.length <= 1 &&
                nlu.intent === 'unknown' &&
                !['si', 'sí', 'no', 'ok', 'dale'].includes(nlu.raw.toLowerCase().trim()),
            action: () => ({
                override: false,
                addSuffix: ' ¿Podés darme un poco más de contexto?',
            }),
        });

        // Regla: respuesta afirmativa sin slots pendientes
        this.addRule({
            name: 'bare_affirmation',
            priority: 4,
            condition: (nlu, ctx) =>
                nlu.intent === 'affirmation' &&
                !ctx.pendingSlots,
            action: () => null, // Dejar que NLG lo maneje
        });
    }
}

module.exports = Reasoner;
