/**
 * Memory.js — Sistema de Memoria del Agente
 * Maneja historial de conversación, contexto de sesión y memoria persistente.
 */

'use strict';

const fs = require('fs');
const path = require('path');

class Memory {
    constructor(config = {}) {
        this.maxHistory = config.maxHistory || 20;
        this.persistSessions = config.persistSessions || false;
        this.storageDir = config.storageDir || path.join(process.cwd(), '.agent-data');
        this.sessions = new Map();

        if (this.persistSessions) {
            this._ensureStorageDir();
        }
    }

    // ─── Gestión de sesiones ──────────────────────────────────────────────────────

    getSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            const saved = this._loadSession(sessionId);
            this.sessions.set(sessionId, saved || {
                id: sessionId,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                history: [],         // mensajes de conversación
                working: {},         // variables en vuelo (carrito, estado, etc.)
                user: {},            // datos del usuario (nombre, preferencias, etc.)
                turnCount: 0,
                pendingSlots: null,  // slots pendientes para completar una acción
            });
        }
        return this.sessions.get(sessionId);
    }

    // ─── Historial de conversación ────────────────────────────────────────────────

    addMessage(sessionId, role, content, metadata = {}) {
        const session = this.getSession(sessionId);
        const message = {
            role,           // 'user' | 'agent'
            content,
            timestamp: Date.now(),
            ...metadata,
        };

        session.history.push(message);
        session.lastActivity = Date.now();
        session.turnCount++;

        // Mantener ventana deslizante
        if (session.history.length > this.maxHistory) {
            session.history = session.history.slice(-this.maxHistory);
        }

        if (this.persistSessions) this._saveSession(sessionId, session);
        return message;
    }

    getHistory(sessionId, limit = null) {
        const session = this.getSession(sessionId);
        if (limit) return session.history.slice(-limit);
        return session.history;
    }

    getLastUserMessage(sessionId) {
        const history = this.getHistory(sessionId);
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'user') return history[i];
        }
        return null;
    }

    // ─── Memoria de trabajo (variables de sesión) ─────────────────────────────────

    setWorking(sessionId, key, value) {
        const session = this.getSession(sessionId);
        session.working[key] = value;
        if (this.persistSessions) this._saveSession(sessionId, session);
    }

    getWorking(sessionId, key = null) {
        const session = this.getSession(sessionId);
        if (key) return session.working[key];
        return session.working;
    }

    deleteWorking(sessionId, key) {
        const session = this.getSession(sessionId);
        delete session.working[key];
    }

    // ─── Datos del usuario ────────────────────────────────────────────────────────

    setUser(sessionId, data) {
        const session = this.getSession(sessionId);
        session.user = { ...session.user, ...data };
        if (this.persistSessions) this._saveSession(sessionId, session);
    }

    getUser(sessionId) {
        return this.getSession(sessionId).user;
    }

    getUserName(sessionId) {
        return this.getSession(sessionId).user.name || null;
    }

    // ─── Slots pendientes para acciones ───────────────────────────────────────────

    setPendingSlots(sessionId, actionName, slots, collectedSoFar = {}) {
        const session = this.getSession(sessionId);
        session.pendingSlots = { actionName, slots, collected: collectedSoFar };
    }

    getPendingSlots(sessionId) {
        return this.getSession(sessionId).pendingSlots;
    }

    clearPendingSlots(sessionId) {
        const session = this.getSession(sessionId);
        session.pendingSlots = null;
    }

    // ─── Resumen conversacional (para contexto comprimido) ────────────────────────

    getSummary(sessionId) {
        const session = this.getSession(sessionId);
        return {
            sessionId,
            turnCount: session.turnCount,
            user: session.user,
            working: session.working,
            recentHistory: session.history.slice(-6),
            hasPendingSlots: !!session.pendingSlots,
        };
    }

    // ─── Reset de sesión ──────────────────────────────────────────────────────────

    clearSession(sessionId) {
        this.sessions.delete(sessionId);
        if (this.persistSessions) {
            const file = this._sessionFile(sessionId);
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
    }

    // ─── Persistencia en disco ────────────────────────────────────────────────────

    _ensureStorageDir() {
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }
    }

    _sessionFile(sessionId) {
        const safe = sessionId.replace(/[^a-z0-9-_]/gi, '_');
        return path.join(this.storageDir, `session_${safe}.json`);
    }

    _saveSession(sessionId, session) {
        try {
            fs.writeFileSync(this._sessionFile(sessionId), JSON.stringify(session, null, 2));
        } catch (e) {
            // silencioso en caso de error de disco
        }
    }

    _loadSession(sessionId) {
        if (!this.persistSessions) return null;
        const file = this._sessionFile(sessionId);
        if (!fs.existsSync(file)) return null;
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            return null;
        }
    }

    // ─── Listado de todas las sesiones (memoria + disco) ─────────────────────────

    getAllSessions() {
        const seen = new Set();
        const result = [];

        // Sesiones en disco
        if (this.persistSessions && fs.existsSync(this.storageDir)) {
            const files = fs.readdirSync(this.storageDir)
                .filter(f => f.startsWith('session_') && f.endsWith('.json'));
            for (const file of files) {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(this.storageDir, file), 'utf8'));
                    const id = data.id;
                    seen.add(id);
                    result.push({
                        id,
                        turnCount: data.turnCount || 0,
                        messageCount: (data.history || []).length,
                        createdAt: data.createdAt,
                        lastActivity: data.lastActivity,
                        user: data.user || {},
                        persisted: true,
                    });
                } catch { /* ignorar archivos corruptos */ }
            }
        }

        // Sesiones en memoria no persistidas
        for (const [id, session] of this.sessions) {
            if (!seen.has(id)) {
                result.push({
                    id: session.id || id,
                    turnCount: session.turnCount || 0,
                    messageCount: (session.history || []).length,
                    createdAt: session.createdAt,
                    lastActivity: session.lastActivity,
                    user: session.user || {},
                    persisted: false,
                });
            }
        }

        return result.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
    }

    getSessionById(sessionId) {
        if (this.sessions.has(sessionId)) return this.sessions.get(sessionId);
        return this._loadSession(sessionId);
    }

    // ─── Stats ────────────────────────────────────────────────────────────────────

    getStats() {
        return {
            activeSessions: this.sessions.size,
            sessionIds: [...this.sessions.keys()],
        };
    }
}

module.exports = Memory;
