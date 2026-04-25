/**
 * api/routes/config.js — Ruta de Configuración
 */

'use strict';

const express = require('express');
const router = express.Router();

module.exports = (brain) => {

    // GET /config — Ver configuración y estadísticas del agente
    router.get('/', (req, res) => {
        res.json({ ok: true, ...brain.getConfig() });
    });

    // POST /config/actions — Registrar acción en runtime
    router.post('/actions', (req, res) => {
        try {
            const { name, description, triggers, intents, slots } = req.body;
            if (!name) return res.status(400).json({ error: 'name es requerido.' });

            // Solo se puede registrar acciones sin handler desde la API (sin handler real)
            brain.registerAction({
                name,
                description: description || name,
                triggers: triggers || [],
                intents: intents || [],
                slots: slots || [],
                handler: async () => `Acción "${name}" ejecutada (modo demo, sin handler real definido).`,
            });

            res.json({ ok: true, message: `Acción "${name}" registrada.` });
        } catch (err) {
            res.status(400).json({ ok: false, error: err.message });
        }
    });

    return router;
};
