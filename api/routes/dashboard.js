/**
 * api/routes/dashboard.js — Endpoints de gestión para el Dashboard
 */

'use strict';

const express = require('express');
const router = express.Router();

module.exports = (brain) => {

    // GET /dashboard/stats — Estadísticas generales del agente
    router.get('/stats', (req, res) => {
        res.json({ ok: true, ...brain.getStats() });
    });

    // GET /dashboard/sessions — Listar todas las sesiones
    router.get('/sessions', (req, res) => {
        const sessions = brain.memory.getAllSessions();
        res.json({ ok: true, sessions });
    });

    // GET /dashboard/sessions/:id — Ver historial completo de una sesión
    router.get('/sessions/:id', (req, res) => {
        const session = brain.memory.getSessionById(req.params.id);
        if (!session) return res.status(404).json({ ok: false, error: 'Sesión no encontrada.' });
        res.json({ ok: true, session });
    });

    // DELETE /dashboard/sessions/:id — Eliminar una sesión específica
    router.delete('/sessions/:id', (req, res) => {
        brain.clearSession(req.params.id);
        res.json({ ok: true, message: `Sesión ${req.params.id} eliminada.` });
    });

    // DELETE /dashboard/sessions — Eliminar todas las sesiones
    router.delete('/sessions', (req, res) => {
        const sessions = brain.memory.getAllSessions();
        for (const s of sessions) brain.clearSession(s.id);
        res.json({ ok: true, message: `${sessions.length} sesiones eliminadas.` });
    });

    // POST /dashboard/test — Probar un mensaje sin afectar sesiones reales
    router.post('/test', async (req, res) => {
        try {
            const { message } = req.body;
            if (!message) return res.status(400).json({ error: 'message es requerido.' });
            const testSessionId = `_test_${Date.now()}`;
            const result = await brain.chat(message, testSessionId);
            brain.clearSession(testSessionId);
            res.json({ ok: true, ...result });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    return router;
};
