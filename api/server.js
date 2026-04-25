/**
 * api/server.js — Servidor Express Principal
 * Maneja HTTP REST + WebSocket para comunicación en tiempo real.
 */

'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const Brain = require('../core/Brain');

function createServer(config) {
    const cfg = config || require('../agent.config');
    const brain = new Brain(cfg);

    const app = express();
    const server = http.createServer(app);

    // ─── Middleware ───────────────────────────────────────────────────────────────
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    if (cfg.server && cfg.server.cors !== false) {
        app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
        }));
    }

    // ─── Archivos estáticos ───────────────────────────────────────────────────────
    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use('/widget', express.static(path.join(__dirname, '..', 'widget')));

    // ─── Rutas ────────────────────────────────────────────────────────────────────
    const chatRoutes = require('./routes/chat')(brain);
    const configRoutes = require('./routes/config')(brain);
    const dashboardRoutes = require('./routes/dashboard')(brain);

    app.use('/chat', chatRoutes);
    app.use('/config', configRoutes);
    app.use('/dashboard', dashboardRoutes);

    // ─── Health check ─────────────────────────────────────────────────────────────
    app.get('/health', (req, res) => {
        res.json({
            ok: true,
            agent: brain.personality.name,
            version: '1.0.0',
            uptime: process.uptime(),
        });
    });

    // ─── Rutas de vistas ──────────────────────────────────────────────────────────
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    });

    app.get('/admin', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
    });

    // ─── WebSocket lite (SSE para streaming alternativo) ─────────────────────────
    app.get('/stream', (req, res) => {
        const sessionId = req.query.sessionId || uuidv4();
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Enviar welcome
        const welcome = brain.getWelcomeMessage(sessionId);
        res.write(`data: ${JSON.stringify({ type: 'welcome', sessionId, ...welcome })}\n\n`);

        // Mantener la conexión viva
        const keepAlive = setInterval(() => res.write(':ping\n\n'), 25000);
        req.on('close', () => clearInterval(keepAlive));
    });

    // ─── WebSocket con ws nativo (si el paquete ws está disponible) ───────────────
    let wss = null;
    try {
        const WebSocket = require('ws');
        wss = new WebSocket.Server({ server });

        wss.on('connection', (ws, req) => {
            const sessionId = uuidv4();
            console.log(`[WS] Nueva conexión: ${sessionId}`);

            // Enviar bienvenida
            const welcome = brain.getWelcomeMessage(sessionId);
            ws.send(JSON.stringify({ type: 'welcome', sessionId, ...welcome }));

            ws.on('message', async (data) => {
                try {
                    const parsed = JSON.parse(data.toString());
                    const message = parsed.message || data.toString();
                    const sid = parsed.sessionId || sessionId;

                    ws.send(JSON.stringify({ type: 'thinking' }));
                    const result = await brain.chat(message, sid);
                    ws.send(JSON.stringify({ type: 'response', sessionId: sid, ...result }));
                } catch (err) {
                    ws.send(JSON.stringify({ type: 'error', error: err.message }));
                }
            });

            ws.on('close', () => console.log(`[WS] Desconectado: ${sessionId}`));
        });

        console.log('[Server] WebSocket habilitado.');
    } catch {
        console.log('[Server] Módulo ws no disponible. Solo HTTP REST activo.');
    }

    // ─── Manejo de errores ────────────────────────────────────────────────────────
    app.use((err, req, res, next) => {
        console.error('[Server Error]', err);
        res.status(500).json({ ok: false, error: 'Error interno del servidor.' });
    });

    // ─── Iniciar ──────────────────────────────────────────────────────────────────
    const port = (cfg.server && cfg.server.port) || process.env.PORT || 3000;

    return {
        app,
        server,
        brain,
        start() {
            server.listen(port, () => {
                console.log('\n╔════════════════════════════════════════╗');
                console.log(`║  🤖 ${brain.personality.name} — Agente IA iniciado`);
                console.log(`║  🌐 http://localhost:${port}`);
                console.log(`║  📡 WS: ws://localhost:${port}`);
                console.log('╚════════════════════════════════════════╝\n');
            });
            return this;
        },
    };
}

module.exports = createServer;

// ─── Inicio directo ───────────────────────────────────────────────────────────
if (require.main === module) {
    const config = require('../agent.config');
    createServer(config).start();
}
