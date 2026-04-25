/**
 * core/Brain.js — Orquestador Central con LLM
 *
 * Pipeline de procesamiento:
 * 1. Intentar respuesta con Ollama LLM (razonamiento real)
 *    a. Si el LLM quiere llamar una tool → ejecutar handler → devolver resultado al LLM
 *    b. Si el LLM responde libremente → devolver texto
 * 2. Fallback: pipeline clásico (NLU → Planner → NLG) si Ollama no está disponible
 */

'use strict';

const NLU = require('./NLU');
const Memory = require('./Memory');
const PersonalityEngine = require('./PersonalityEngine');
const ActionRegistry = require('./ActionRegistry');
const ActionExecutor = require('./ActionExecutor');
const Planner = require('./Planner');
const Reasoner = require('./Reasoner');
const NLG = require('./NLG');
const LLMEngine = require('./LLMEngine');

class Brain {
    constructor(config = {}) {
        this.config = config;
        const agentCfg = config.agent || {};
        const memoryCfg = config.memory || {};
        const llmCfg = config.llm || {};

        // ── Subsistemas núcleo ─────────────────────────────────────────────────────
        this.personality = new PersonalityEngine(agentCfg);
        this.memory = new Memory(memoryCfg);
        this.nlu = new NLU({ language: agentCfg.language || 'es' });
        this.actionRegistry = new ActionRegistry();
        this.actionExecutor = new ActionExecutor(this.memory, this.actionRegistry);
        this.planner = new Planner({ registry: this.actionRegistry, memory: this.memory });
        this.reasoner = new Reasoner();
        this.nlg = new NLG(agentCfg);

        // ── Motor LLM ──────────────────────────────────────────────────────────────
        this.llm = new LLMEngine({
            model: llmCfg.model || agentCfg.llmModel || 'llama3.2',
            host: llmCfg.host || 'http://127.0.0.1:11434',
        });

        // ── Registrar acciones de la configuración ─────────────────────────────────
        const actions = config.actions || [];
        for (const action of actions) {
            this.actionRegistry.register(action);
        }

        this.debug = config.debug || false;
    }

    // ─── API pública: procesar un mensaje ─────────────────────────────────────────

    async chat(message, sessionId = 'default') {
        const start = Date.now();

        // Inicializar/recuperar sesión
        const session = this.memory.getSession(sessionId);

        // Guardar mensaje del usuario en memoria
        this.memory.addMessage(sessionId, 'user', message);

        let response, intent, confidence, thoughts = [], usedLLM = false;

        // ── 1. Intentar con LLM (Ollama) ────────────────────────────────────────
        const llmAvailable = await this.llm.checkAvailability();

        if (llmAvailable) {
            try {
                const result = await this._chatWithLLM(message, session, sessionId);
                response = result.response;
                intent = 'llm';
                confidence = 1.0;
                thoughts = result.thoughts;
                usedLLM = true;
            } catch (err) {
                if (this.debug) console.error('[Brain] Error LLM:', err.message);
                // Caer al pipeline clásico
            }
        }

        // ── 2. Fallback: pipeline clásico (NLU → Planner → NLG) ────────────────
        if (!usedLLM) {
            const fallback = await this._chatClassic(message, session, sessionId);
            response = fallback.response;
            intent = fallback.intent;
            confidence = fallback.confidence;
            thoughts = fallback.thoughts;
        }

        // Guardar respuesta del agente en memoria
        this.memory.addMessage(sessionId, 'assistant', response, { intent });

        return {
            response,
            intent,
            confidence,
            thoughts,
            sessionId,
            elapsed: Date.now() - start,
            engine: usedLLM ? 'llm' : 'classic',
            model: usedLLM ? this.llm.model : null,
        };
    }

    // ─── Chat con LLM + tool calling ──────────────────────────────────────────────

    async _chatWithLLM(message, session, sessionId) {
        const thoughts = [];
        const actions = [...this.actionRegistry.actions.values()];
        const personality = this.personality.toJSON();

        // Historial de conversación (sin el mensaje actual que ya agregamos)
        const history = (session.history || [])
            .slice(-20) // últimos 20 mensajes para no agotar contexto
            .slice(0, -1) // sin el último (el que recién agregamos)
            .map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content }));

        thoughts.push(`[LLM] Enviando a ${this.llm.model} con ${history.length} mensajes de historial`);

        const result = await this.llm.chat(history, message, personality, actions);

        // El LLM quiere ejecutar una acción/tool
        if (result.toolCall) {
            const { name, params } = result.toolCall;
            thoughts.push(`[Tool] ${name} llamado con params: ${JSON.stringify(params)}`);

            const action = this.actionRegistry.get(name);
            if (action && action.handler) {
                let actionResult;
                try {
                    const ctx = {
                        sessionId,
                        user: session.user || {},
                        working: session.working || {},
                        memory: this.memory,
                    };
                    actionResult = await action.handler(params, ctx);
                    thoughts.push(`[Tool] Resultado: ${String(actionResult).substring(0, 100)}`);
                } catch (err) {
                    actionResult = `Error al ejecutar la acción: ${err.message}`;
                }

                // Segunda vuelta: el LLM integra el resultado de la tool en su respuesta
                const finalResponse = await this.llm.chatWithToolResult(
                    history, message, this.personality.toJSON(), name, actionResult
                );

                return {
                    response: finalResponse || actionResult,
                    thoughts,
                };
            }

            // Acción no encontrada — respuesta directa del handler sin LLM
            return { response: `No pude ejecutar la acción "${name}".`, thoughts };
        }

        // Respuesta de texto libre del LLM
        thoughts.push(`[LLM] Respuesta libre (${result.text.length} chars)`);
        return { response: result.text, thoughts };
    }

    // ─── Pipeline clásico (NLU → Reasoner → Planner → NLG) ───────────────────────

    async _chatClassic(message, session, sessionId) {
        const thoughts = ['[Classic] Usando pipeline NLU → Planner → NLG'];

        const nluResult = this.nlu.analyze(message);
        thoughts.push(`[NLU] intent=${nluResult.intent} conf=${nluResult.confidence}`);

        const ruleResult = this.reasoner.apply(nluResult, session);
        if (ruleResult) {
            thoughts.push(`[Reasoner] Regla aplicada: ${ruleResult.appliedRule}`);
            if (ruleResult.override && ruleResult.intent) {
                nluResult.intent = ruleResult.intent;
                if (ruleResult.extractedName) {
                    this.memory.setUser(sessionId, 'name', ruleResult.extractedName);
                    session.user = session.user || {};
                    session.user.name = ruleResult.extractedName;
                }
            }
        }

        const planResult = this.planner.reason(nluResult, sessionId);
        const { plan } = planResult;
        thoughts.push(`[Planner] plan=${plan}`);

        let response;

        if (plan === 'slot_filling') {
            response = planResult.slotQuestion;
        } else if (plan === 'action') {
            const actionResult = await this.actionExecutor.execute(
                planResult.action, nluResult, sessionId
            );
            if (actionResult.needsSlot) {
                response = actionResult.question;
            } else {
                response = actionResult.response;
            }
            thoughts.push(`[Action] ${planResult.action?.name}: ${response?.substring(0, 80)}`);
        } else {
            const userName = session.user?.name || null;
            response = this.nlg.generate(nluResult, {
                userName,
                agentName: this.personality.name,
                sentiment: nluResult.sentiment,
                turnCount: session.turnCount || 1,
                ruleResult,
            });
            thoughts.push(`[NLG] Generado por template`);
        }

        return {
            response,
            intent: nluResult.intent,
            confidence: nluResult.confidence,
            thoughts,
        };
    }

    // ─── Utilidades ───────────────────────────────────────────────────────────────

    getWelcomeMessage(sessionId) {
        const session = this.memory.getSession(sessionId);
        const welcome = this.personality.getWelcome();
        this.memory.addMessage(sessionId, 'assistant', welcome);
        return { response: welcome, sessionId };
    }

    clearSession(sessionId) {
        this.memory.clearSession(sessionId);
        return { cleared: true, sessionId };
    }

    registerAction(action) {
        this.actionRegistry.register(action);
    }

    getConfig() {
        const agentCfg = this.personality.toJSON();
        const allActions = [...this.actionRegistry.actions.values()];
        const llmStatus = this.llm.getStatus();

        return {
            agent: agentCfg,
            actionsCount: allActions.length,
            actions: allActions.map(a => ({
                name: a.name,
                description: a.description,
                triggers: a.triggers,
                slots: a.slots,
            })),
            engine: llmStatus.available ? 'ollama' : 'classic',
            llm: llmStatus,
        };
    }

    getStats() {
        const cfg = this.getConfig();
        const sessions = this.memory.getAllSessions();
        const totalMessages = sessions.reduce((sum, s) => sum + (s.messageCount || 0), 0);

        return {
            ...cfg,
            uptime: process.uptime(),
            totalSessions: sessions.length,
            activeSessions: this.memory.getStats().activeSessions,
            totalMessages,
            sessions,
        };
    }
}

module.exports = Brain;
