/**
 * Planner.js — Planificador de Tareas con Razonamiento en Cadena
 * Decide qué hacer dado el análisis NLU y el contexto de la sesión.
 * Implementa Chain-of-Thought programático.
 */

'use strict';

class Planner {
    constructor({ registry, memory }) {
        this.registry = registry;
        this.memory = memory;
    }

    /**
     * Plan de ejecución:
     * 1. Hay slots pendientes? → Continuar slot filling
     * 2. Hay acción que coincide? → Ejecutar acción
     * 3. Es una intención estándar? → Respuesta NLG
     * 4. Fallback
     *
     * @returns {{ type, actionName?, intent, reasoning }}
     */
    plan(nluResult, sessionId) {
        const steps = [];
        const { intent, confidence, tokens, entities, sentiment } = nluResult;

        // ─── PASO 1: ¿Hay un flujo de slots en curso? ────────────────────────────
        const pending = this.memory.getPendingSlots(sessionId);
        if (pending) {
            // Verificar si el usuario quiere cancelar el slot filling
            if (['negation', 'farewell'].includes(intent) && confidence > 0.6) {
                steps.push('Slot filling cancelado por el usuario.');
                this.memory.clearPendingSlots(sessionId);
                return { type: 'nlg', intent: 'negation', reasoning: steps };
            }
            steps.push(`Continuando slot filling para acción: ${pending.actionName}`);
            return {
                type: 'continue_slots',
                actionName: pending.actionName,
                intent,
                reasoning: steps,
            };
        }

        // ─── PASO 2: ¿Hay acción que coincide con el texto? ─────────────────────
        if (this.registry.size > 0) {
            const match = this.registry.findBestAction(nluResult.raw, intent, tokens || []);
            if (match && match.score > 0) {
                steps.push(`Acción encontrada: "${match.action.name}" (score: ${match.score})`);
                return {
                    type: 'action',
                    actionName: match.action.name,
                    intent,
                    reasoning: steps,
                };
            }
        }

        // ─── PASO 3: Intención pura con NLG ─────────────────────────────────────
        steps.push(`Intención "${intent}" con confianza ${confidence}. Sin acción específica → NLG.`);
        return { type: 'nlg', intent, reasoning: steps };
    }

    /**
     * Multi-step reasoning: desglosa una tarea compleja en pasos.
     * Por ahora implementado como árbol de decisión con logging.
     */
    reason(nluResult, sessionId) {
        const thoughts = [];

        thoughts.push(`[Texto]: "${nluResult.raw}"`);
        thoughts.push(`[Intención]: ${nluResult.intent} (confianza: ${nluResult.confidence})`);

        if (Object.keys(nluResult.entities).length > 0) {
            thoughts.push(`[Entidades]: ${JSON.stringify(nluResult.entities)}`);
        }

        thoughts.push(`[Sentimiento]: ${nluResult.sentiment}`);

        const user = this.memory.getUser(sessionId);
        if (user.name) thoughts.push(`[Usuario conocido]: ${user.name}`);

        const pending = this.memory.getPendingSlots(sessionId);
        if (pending) thoughts.push(`[Slots pendientes]: ${pending.actionName}`);

        const plan = this.plan(nluResult, sessionId);
        thoughts.push(`[Plan]: ${plan.type} ${plan.actionName ? '→ ' + plan.actionName : ''}`);

        return { plan, thoughts };
    }
}

module.exports = Planner;
