/**
 * api/routes/chat.js — Ruta de Chat
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

module.exports = (brain) => {

    // POST /chat — Enviar mensaje al agente
    router.post('/', async (req, res) => {
        try {
            const { message, sessionId } = req.body;

            if (!message || typeof message !== 'string' || message.trim() === '') {
                return res.status(400).json({ error: 'El campo "message" es requerido.' });
            }

            const sid = sessionId || uuidv4();
            const result = await brain.chat(message.trim(), sid);

            res.json({
                ok: true,
                sessionId: sid,
                ...result,
            });
        } catch (err) {
            console.error('[Chat Route Error]', err);
            res.status(500).json({ ok: false, error: 'Error interno del agente.' });
        }
    });

    // GET /chat/welcome — Mensaje de bienvenida para una sesión nueva
    router.get('/welcome', (req, res) => {
        const sessionId = req.query.sessionId || uuidv4();
        const welcome = brain.getWelcomeMessage(sessionId);
        res.json({ ok: true, sessionId, ...welcome });
    });

    // DELETE /chat/session — Limpiar sesión
    router.delete('/session', (req, res) => {
        const { sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'sessionId requerido.' });
        brain.clearSession(sessionId);
        res.json({ ok: true, message: 'Sesión limpiada.' });
    });

    return router;
};
