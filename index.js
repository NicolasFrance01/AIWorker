/**
 * index.js — Punto de Entrada del Agente
 * Inicia el servidor con la configuración por defecto.
 */

'use strict';

const createServer = require('./api/server');
const config = require('./agent.config');

createServer(config).start();
