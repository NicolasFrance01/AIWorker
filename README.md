# Agent-AI — Motor de IA Conversacional

> Agente conversacional **100% programable** sin APIs de IA externas. Instálalo en cualquier proyecto, personalízalo con tu propio nombre y acciones, y tenés un asistente inteligente listo.

## 🚀 Inicio Rápido

```bash
npm install
node index.js
```

Luego abrí `http://localhost:3000` en tu navegador.

---

## 🏗 Estructura del Proyecto

```
agent-ai/
├── agent.config.js       ← ⭐ CONFIGURACIÓN PRINCIPAL (personaliza aquí)
├── index.js              ← Punto de entrada
├── core/
│   ├── Brain.js          ← Motor central (orquesta todo)
│   ├── NLU.js            ← Comprensión de lenguaje natural
│   ├── NLG.js            ← Generación de respuestas
│   ├── Memory.js         ← Sistema de memoria
│   ├── Planner.js        ← Planificador (chain-of-thought)
│   ├── Reasoner.js       ← Motor de reglas
│   ├── PersonalityEngine.js ← Personalidad del agente
│   ├── ActionRegistry.js ← Registro de acciones
│   └── ActionExecutor.js ← Ejecutor de acciones
├── api/
│   ├── server.js         ← Servidor Express
│   └── routes/
│       ├── chat.js       ← POST /chat
│       └── config.js     ← GET /config
├── widget/
│   └── agent-widget.js   ← Widget embebible
├── public/
│   └── index.html        ← Panel de control / Demo UI
└── examples/
    └── shop-agent/       ← Ejemplo: agente de tienda
```

---

## ⚙️ Personalización (agent.config.js)

```js
module.exports = {
  agent: {
    name: 'MiAgente',      // Nombre del agente
    language: 'es',        // 'es' o 'en'
    tone: 'friendly',      // friendly | formal | casual | technical
    role: 'asistente',
  },
  actions: [
    {
      name: 'buscarProducto',
      description: 'Busca un producto en el catálogo',
      triggers: ['buscar', 'quiero', 'tenés'],
      slots: [{ name: 'productName', question: 'qué producto querés buscar', required: true }],
      handler: async (params, context) => {
        // Tu lógica aquí ↓
        return `Buscando ${params.productName}...`;
      },
    }
  ],
};
```

---

## 🌐 API REST

| Método | URL | Descripción |
|--------|-----|-------------|
| `POST` | `/chat` | Enviar mensaje al agente |
| `GET` | `/chat/welcome` | Obtener bienvenida |
| `DELETE` | `/chat/session` | Limpiar sesión |
| `GET` | `/config` | Ver configuración y acciones |

**Ejemplo:**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hola!", "sessionId": "user-1"}'
```

---

## 🧩 Widget Embebible

Pegá este código en cualquier HTML:

```html
<script
  src="http://tu-servidor/widget/agent-widget.js"
  data-agent-url="http://tu-servidor"
  data-agent-name="Aria"
  data-color="#6C63FF">
</script>
```

---

## 🧠 ¿Cómo funciona el razonamiento?

Sin APIs de IA externas. Todo el procesamiento es local:

1. **NLU** — Tokeniza el texto, detecta la intención por coincidencia ponderada (TF-IDF simplificado) y extrae entidades con regex
2. **Reasoner** — Aplica reglas `IF-THEN` para detectar casos especiales (nombre del usuario, mensajes repetidos, etc.)
3. **Planner** — Decide si ejecutar una acción, continuar slot-filling, o generar respuesta NLG
4. **ActionExecutor** — Si se necesita una acción, valida parámetros y los solicita conversacionalmente
5. **NLG** — Genera una respuesta natural usando templates con variaciones según el tono configurado
