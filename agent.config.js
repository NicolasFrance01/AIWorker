/**
 * agent.config.js — Configuración Central del Agente
 * Personaliza el nombre, personalidad, acciones y comportamiento del agente.
 * ¡Modifica este archivo para adaptar el agente a tu proyecto!
 */

'use strict';

module.exports = {
  // ─── Personalidad del agente ──────────────────────────────────────────────────
  agent: {
    name: 'Aria',             // Nombre del agente
    language: 'es',           // 'es' | 'en'
    tone: 'friendly',         // 'friendly' | 'formal' | 'casual' | 'technical'
    avatar: '🤖',             // Emoji o URL de imagen
    role: 'asistente virtual',

    // Mensaje personalizado de bienvenida (opcional)
    // welcomeMessage: '¡Hola! Soy Aria. ¿En qué te puedo ayudar?',

    // Mensaje de fallback personalizado (opcional)
    // fallbackMessage: 'No entendí eso. ¿Podés explicarlo diferente?',

    // Frases personalizadas (sobreescriben las por defecto)
    phrases: {
      // greeting: ['¡Bienvenido! Soy Aria, tu asistente.'],
      // farewell: ['¡Hasta la próxima!'],
    },
  },

  // ─── Memoria ──────────────────────────────────────────────────────────────────
  memory: {
    maxHistory: 20,          // Mensajes a recordar por sesión
    persistSessions: true,   // Guardar sesiones en disco para recordar entre reinicios
    storageDir: './.agent-data',
  },

  // ─── Servidor ─────────────────────────────────────────────────────────────────
  server: {
    port: process.env.PORT || 3000,
    cors: true,
  },

  // ── Motor LLM (Ollama) ────────────────────────────────────────────────────────
  // Requerís tener Ollama corriendo: https://ollama.com/download
  // Luego corré: ollama pull llama3.2
  // Si tu PC es limitada: ollama pull phi4-mini (más rápido, menos RAM)
  llm: {
    model: 'llama3.2',                // Modelo a usar. Ejemplos: llama3.2, phi4-mini, mistral, gemma3
    host: 'http://127.0.0.1:11434',   // URL de Ollama local (no cambiar si es local)
  },

  // ── Debug ─────────────────────────────────────────────────────────────────────
  debug: process.env.DEBUG === 'true',

  // ─── Acciones del agente ─────────────────────────────────────────────────────
  // Aquí registrás las acciones específicas de tu proyecto.
  // Cada acción es un objeto con: name, description, triggers, slots, handler.
  //
  // Ejemplo:
  // actions: [
  //   require('./actions/searchProduct'),
  //   require('./actions/getWeather'),
  // ],
  actions: [
    // ─── Acción de ejemplo: hora actual ────────────────────────────────────────
    {
      name: 'getCurrentTime',
      description: 'Dice la hora actual',
      triggers: ['hora', 'qué hora', 'que hora', 'hora es', 'decime la hora'],
      intents: ['question'],
      slots: [],
      handler: async (params, context) => {
        const now = new Date();
        const hora = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const fecha = now.toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        return `🕐 Son las **${hora}** del ${fecha}.`;
      },
    },

    // ─── Acción de ejemplo: calcular ───────────────────────────────────────────
    {
      name: 'calculate',
      description: 'Realiza cálculos matemáticos. Usá cuando el usuario pregunta cuánto es una operación matemática.',
      triggers: ['calcul', 'cuánto es', 'cuanto es', 'suma', 'resta', 'multiplica', 'divide', 'resultado de'],
      intents: ['question'],
      slots: [
        {
          name: 'expression',
          question: 'qué operación matemática querés calcular',
          required: true,
          type: 'string',
        },
      ],
      handler: async (params) => {
        const raw = (params.expression || '').replace(/[^0-9+\-*/().\s]/g, '').trim();
        if (!raw) return 'No encontré una operación matemática. Probá con "5 + 3" o "100 / 4".';
        try {
          // eslint-disable-next-line no-new-func
          const result = Function(`'use strict'; return (${raw})`)();
          if (!isFinite(result)) return 'Esa operación no tiene resultado numérico válido.';
          return `El resultado de **${raw}** es **${result}**.`;
        } catch {
          return 'No pude calcular eso. Asegurate de usar números y símbolos (+, -, *, /).';
        }
      },
    },


    // ─── Acción de ejemplo: chiste ─────────────────────────────────────────────
    {
      name: 'tellJoke',
      description: 'Cuenta un chiste',
      triggers: ['chiste', 'hazme reir', 'algo gracioso', 'cuéntame algo divertido', 'joke'],
      intents: [],
      slots: [],
      handler: async () => {
        const jokes = [
          '¿Por qué el libro de matemáticas estaba triste? Porque tenía demasiados problemas. 😄',
          '¿Qué hace una abeja en el gimnasio? ¡Zum-ba! 🐝',
          '¿Cómo llamas a un dinosaurio dormido? Un dino-roncio. 🦕',
          '¿Por qué los pájaros vuelan al sur? Porque caminar es demasiado lejos. 🐦',
          'Soy un chiste que se cuenta solo... espera, eso no tiene sentido. 😅',
        ];
        return jokes[Math.floor(Math.random() * jokes.length)];
      },
    },
  ],

  // ─── Reglas personalizadas de razonamiento ────────────────────────────────────
  // reasoning: {
  //   rules: [
  //     {
  //       name: 'vip_user',
  //       priority: 10,
  //       condition: (nlu, ctx) => ctx.user.isVip === true,
  //       action: (nlu, ctx) => ({ addPrefix: '🌟 (Usuario VIP) ' }),
  //     }
  //   ]
  // }
  reasoning: {},
};
