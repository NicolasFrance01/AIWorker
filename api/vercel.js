'use strict';

// Entry point para Vercel serverless — exporta la app Express sin llamar listen()
// Ollama no está disponible en Vercel: el agente usa automáticamente el pipeline clásico.
// La persistencia en disco se desactiva (filesystem efímero en serverless).

const createServer = require('./server');
const config = require('../agent.config');

const vercelConfig = {
    ...config,
    memory: {
        ...config.memory,
        persistSessions: false,
    },
};

const { app } = createServer(vercelConfig);

module.exports = app;
