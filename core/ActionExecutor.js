/**
 * ActionExecutor.js — Ejecutor de Acciones
 * Valida parámetros, recopila slots faltantes y ejecuta handlers.
 */

'use strict';

class ActionExecutor {
    constructor({ registry, memory, personality }) {
        this.registry = registry;
        this.memory = memory;
        this.personality = personality;
    }

    /**
     * Intenta ejecutar una acción.
     * Si faltan slots, los solicita al usuario.
     * Retorna { type, response, actionName, result }
     */
    async execute(actionName, nluResult, sessionId) {
        const action = this.registry.get(actionName);
        if (!action) {
            return {
                type: 'error',
                response: this.personality.getPhrase('error', { detail: `Acción "${actionName}" no encontrada.` }),
            };
        }

        // ─── 1. Recolectar slots (parámetros requeridos) ──────────────────────────
        const collected = await this._resolveSlots(action, nluResult, sessionId);

        if (collected.needMore) {
            // Hay slots faltantes — guardar estado y pedir al usuario
            this.memory.setPendingSlots(sessionId, actionName, collected.missingSlots, collected.params);
            return {
                type: 'slot_request',
                response: this.personality.getPhrase('missingSlot', {
                    slotQuestion: collected.missingSlots[0].question,
                }),
                pendingAction: actionName,
            };
        }

        // ─── 2. Ejecutar el handler ───────────────────────────────────────────────
        try {
            const context = {
                sessionId,
                user: this.memory.getUser(sessionId),
                working: this.memory.getWorking(sessionId),
                history: this.memory.getHistory(sessionId, 10),
                nlu: nluResult,
                memory: this.memory,
            };

            const result = await action.handler(collected.params, context);
            this.memory.clearPendingSlots(sessionId);

            // El handler puede retornar un string (respuesta directa) o un objeto
            if (typeof result === 'string') {
                return {
                    type: 'action_result',
                    response: result,
                    actionName,
                };
            }

            // { message, data, redirect, ... }
            return {
                type: 'action_result',
                response: result.message || this.personality.getPhrase('actionSuccess', { result: JSON.stringify(result.data || '') }),
                actionName,
                data: result.data || null,
                meta: result,
            };
        } catch (err) {
            this.memory.clearPendingSlots(sessionId);
            return {
                type: 'error',
                response: this.personality.getPhrase('error', { detail: err.message }),
                error: err.message,
            };
        }
    }

    /**
     * Continúa la recolección de slots si hay una acción pendiente.
     */
    async continueSlotFilling(sessionId, nluResult) {
        const pending = this.memory.getPendingSlots(sessionId);
        if (!pending) return null;

        const { actionName, slots, collected: existingParams } = pending;
        const action = this.registry.get(actionName);
        if (!action) {
            this.memory.clearPendingSlots(sessionId);
            return null;
        }

        // Intentar extraer el slot que estamos esperando del último mensaje
        const nextSlot = slots[0];
        let value = this._extractSlotValue(nextSlot, nluResult);

        if (!value) {
            // Si no se detectó, usar el texto completo como valor
            value = nluResult.raw.trim();
        }

        const updatedParams = { ...existingParams, [nextSlot.name]: value };
        const remainingSlots = slots.slice(1);

        if (remainingSlots.length > 0) {
            // Aún hay más slots que pedir
            this.memory.setPendingSlots(sessionId, actionName, remainingSlots, updatedParams);
            return {
                type: 'slot_request',
                response: this.personality.getPhrase('missingSlot', {
                    slotQuestion: remainingSlots[0].question,
                }),
                pendingAction: actionName,
            };
        }

        // Todos los slots recolectados — ejecutar
        this.memory.clearPendingSlots(sessionId);
        return this.execute(actionName, { ...nluResult, collectedParams: updatedParams }, sessionId);
    }

    // ─── Helpers internos ─────────────────────────────────────────────────────────

    async _resolveSlots(action, nluResult, sessionId) {
        const params = {};
        const missingSlots = [];

        // Obtener params ya recolectados en slots anteriores
        const pending = this.memory.getPendingSlots(sessionId);
        if (pending && pending.collected) {
            Object.assign(params, pending.collected);
        }

        for (const slot of action.slots) {
            if (!slot.required) continue;
            if (params[slot.name]) continue; // ya recolectado

            // Intentar autorellenar desde entities NLU
            const value = this._extractSlotValue(slot, nluResult);
            if (value) {
                params[slot.name] = value;
            } else {
                missingSlots.push(slot);
            }
        }

        return {
            params,
            missingSlots,
            needMore: missingSlots.length > 0,
        };
    }

    _extractSlotValue(slot, nluResult) {
        const entities = nluResult.entities || {};
        // Buscar por entityKey específica
        if (slot.entityKey && entities[slot.entityKey]) return entities[slot.entityKey];
        // Buscar por nombre del slot
        if (entities[slot.name]) return entities[slot.name];
        // Buscar en tokens comunes
        if (slot.type === 'number' && entities.number) return entities.number;
        if (slot.type === 'email' && entities.email) return entities.email;
        if (slot.type === 'date' && entities.date) return entities.date;
        return null;
    }
}

module.exports = ActionExecutor;
