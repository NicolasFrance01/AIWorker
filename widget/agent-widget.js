/**
 * agent-widget.js — Widget Embebible del Agente
 * Pega este script en cualquier página HTML y tendrás un chat flotante.
 *
 * Uso:
 *   <script src="/widget/agent-widget.js"
 *           data-agent-url="http://localhost:3000"
 *           data-agent-name="Aria"
 *           data-position="right">
 *   </script>
 */

(function () {
    'use strict';

    // ─── Configuración desde atributos data- ──────────────────────────────────────
    const currentScript = document.currentScript || document.querySelector('script[data-agent-url]');
    const AGENT_URL = (currentScript && currentScript.getAttribute('data-agent-url')) || 'http://localhost:3000';
    const AGENT_NAME = (currentScript && currentScript.getAttribute('data-agent-name')) || 'Aria';
    const POSITION = (currentScript && currentScript.getAttribute('data-position')) || 'right';
    const THEME_COLOR = (currentScript && currentScript.getAttribute('data-color')) || '#6C63FF';
    const WIDGET_ID = 'agent-ai-widget';

    if (document.getElementById(WIDGET_ID)) return; // Ya montado

    // ─── Estado ───────────────────────────────────────────────────────────────────
    let sessionId = 'ws-' + Math.random().toString(36).substr(2, 9);
    let isOpen = false;
    let isTyping = false;

    // ─── Inyectar CSS ─────────────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
    #${WIDGET_ID} * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; }
    #${WIDGET_ID}-btn {
      position: fixed; ${POSITION}: 24px; bottom: 24px; z-index: 99999;
      width: 60px; height: 60px; border-radius: 50%;
      background: ${THEME_COLOR}; border: none; cursor: pointer;
      box-shadow: 0 4px 20px rgba(108,99,255,.5);
      display: flex; align-items: center; justify-content: center;
      font-size: 26px; transition: transform .3s, box-shadow .3s;
      animation: agentPulse 2s infinite;
    }
    #${WIDGET_ID}-btn:hover { transform: scale(1.1); box-shadow: 0 6px 28px rgba(108,99,255,.7); }
    @keyframes agentPulse {
      0%,100% { box-shadow: 0 4px 20px rgba(108,99,255,.5); }
      50% { box-shadow: 0 4px 28px rgba(108,99,255,.8); }
    }
    #${WIDGET_ID}-window {
      position: fixed; ${POSITION}: 24px; bottom: 96px; z-index: 99998;
      width: 360px; height: 520px; max-height: 80vh;
      background: #fff; border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,.2);
      display: flex; flex-direction: column; overflow: hidden;
      transform: scale(0) translateY(20px); transform-origin: bottom right;
      opacity: 0; transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .25s;
      pointer-events: none;
    }
    #${WIDGET_ID}-window.open {
      transform: scale(1) translateY(0); opacity: 1; pointer-events: all;
    }
    #${WIDGET_ID}-header {
      background: linear-gradient(135deg, ${THEME_COLOR}, #9c8bff);
      padding: 16px 20px; display: flex; align-items: center; gap: 12px;
    }
    #${WIDGET_ID}-avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: rgba(255,255,255,.2); display: flex; align-items: center;
      justify-content: center; font-size: 20px;
    }
    #${WIDGET_ID}-header-info h3 { color:#fff; margin:0; font-size:15px; font-weight:600; }
    #${WIDGET_ID}-header-info span { color: rgba(255,255,255,.8); font-size:12px; }
    #${WIDGET_ID}-close-btn {
      margin-left: auto; background: none; border: none; cursor: pointer;
      color: rgba(255,255,255,.8); font-size: 20px; padding: 4px; line-height:1;
    }
    #${WIDGET_ID}-close-btn:hover { color: #fff; }
    #${WIDGET_ID}-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 12px;
      background: #f8f9ff;
    }
    #${WIDGET_ID}-messages::-webkit-scrollbar { width: 4px; }
    #${WIDGET_ID}-messages::-webkit-scrollbar-thumb { background: #d0d0e8; border-radius: 4px; }
    .agent-msg { display: flex; gap: 8px; max-width: 85%; }
    .agent-msg.user { align-self: flex-end; flex-direction: row-reverse; }
    .agent-msg-bubble {
      padding: 10px 14px; border-radius: 18px; font-size: 14px; line-height: 1.5;
      word-wrap: break-word; white-space: pre-wrap;
    }
    .agent-msg.bot .agent-msg-bubble {
      background: #fff; color: #333;
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
      border-bottom-left-radius: 4px;
    }
    .agent-msg.user .agent-msg-bubble {
      background: ${THEME_COLOR}; color: #fff; border-bottom-right-radius: 4px;
    }
    .agent-msg-avatar {
      width: 28px; height: 28px; border-radius: 50%; font-size: 14px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      background: linear-gradient(135deg, ${THEME_COLOR}, #9c8bff);
    }
    .agent-typing {
      display: flex; gap: 4px; align-items: center; padding: 8px 12px;
    }
    .agent-typing span {
      width: 7px; height: 7px; background: #9c8bff; border-radius: 50%;
      animation: agentBounce .9s infinite;
    }
    .agent-typing span:nth-child(2) { animation-delay: .15s; }
    .agent-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes agentBounce {
      0%,80%,100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
    }
    #${WIDGET_ID}-input-area {
      padding: 12px 16px; background: #fff; border-top: 1px solid #f0f0f8;
      display: flex; gap: 8px; align-items: flex-end;
    }
    #${WIDGET_ID}-input {
      flex: 1; border: 1.5px solid #e8e8f8; border-radius: 12px;
      padding: 10px 14px; font-size: 14px; outline: none; resize: none;
      max-height: 100px; min-height: 42px; line-height: 1.4;
      transition: border-color .2s;
      font-family: inherit;
    }
    #${WIDGET_ID}-input:focus { border-color: ${THEME_COLOR}; }
    #${WIDGET_ID}-send {
      width: 42px; height: 42px; border-radius: 50%; border: none;
      background: ${THEME_COLOR}; color: #fff; cursor: pointer; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      transition: background .2s, transform .1s; flex-shrink: 0;
    }
    #${WIDGET_ID}-send:hover { background: #5a52e8; transform: scale(1.05); }
    #${WIDGET_ID}-send:active { transform: scale(0.95); }
    .agent-msg-bubble strong { font-weight: 600; }
    @media (max-width: 400px) {
      #${WIDGET_ID}-window { width: calc(100vw - 32px); ${POSITION}: 16px; bottom: 84px; }
    }
  `;
    document.head.appendChild(style);

    // ─── Markup HTML ──────────────────────────────────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.id = WIDGET_ID;
    wrapper.innerHTML = `
    <button id="${WIDGET_ID}-btn" title="Abrir chat con ${AGENT_NAME}">🤖</button>
    <div id="${WIDGET_ID}-window" role="dialog" aria-label="Chat con ${AGENT_NAME}">
      <div id="${WIDGET_ID}-header">
        <div id="${WIDGET_ID}-avatar">🤖</div>
        <div id="${WIDGET_ID}-header-info">
          <h3>${AGENT_NAME}</h3>
          <span>● En línea</span>
        </div>
        <button id="${WIDGET_ID}-close-btn" aria-label="Cerrar chat">✕</button>
      </div>
      <div id="${WIDGET_ID}-messages" role="log" aria-live="polite"></div>
      <div id="${WIDGET_ID}-input-area">
        <textarea id="${WIDGET_ID}-input"
          placeholder="Escribí tu mensaje..."
          rows="1" aria-label="Mensaje"></textarea>
        <button id="${WIDGET_ID}-send" aria-label="Enviar">➤</button>
      </div>
    </div>
  `;
    document.body.appendChild(wrapper);

    // ─── Referencias DOM ──────────────────────────────────────────────────────────
    const chatBtn = document.getElementById(`${WIDGET_ID}-btn`);
    const chatWindow = document.getElementById(`${WIDGET_ID}-window`);
    const messagesEl = document.getElementById(`${WIDGET_ID}-messages`);
    const inputEl = document.getElementById(`${WIDGET_ID}-input`);
    const sendBtn = document.getElementById(`${WIDGET_ID}-send`);
    const closeBtn = document.getElementById(`${WIDGET_ID}-close-btn`);

    // ─── Helpers ──────────────────────────────────────────────────────────────────
    function renderMarkdown(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code style="background:#f0f0f8;padding:2px 5px;border-radius:4px;font-size:12px">$1</code>')
            .replace(/\n/g, '<br>');
    }

    function addMessage(text, role) {
        const div = document.createElement('div');
        div.className = `agent-msg ${role}`;
        const avatarEmoji = role === 'bot' ? '🤖' : '👤';
        div.innerHTML = `
      <div class="agent-msg-avatar">${avatarEmoji}</div>
      <div class="agent-msg-bubble">${renderMarkdown(text)}</div>
    `;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
    }

    function showTyping() {
        if (isTyping) return;
        isTyping = true;
        const div = document.createElement('div');
        div.className = 'agent-msg bot';
        div.id = `${WIDGET_ID}-typing`;
        div.innerHTML = `
      <div class="agent-msg-avatar">🤖</div>
      <div class="agent-msg-bubble agent-typing">
        <span></span><span></span><span></span>
      </div>
    `;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function hideTyping() {
        isTyping = false;
        const t = document.getElementById(`${WIDGET_ID}-typing`);
        if (t) t.remove();
    }

    // ─── Toggle Widget ────────────────────────────────────────────────────────────
    function toggleChat() {
        isOpen = !isOpen;
        chatWindow.classList.toggle('open', isOpen);
        chatBtn.innerHTML = isOpen ? '✕' : '🤖';
        if (isOpen) {
            inputEl.focus();
            if (messagesEl.children.length === 0) loadWelcome();
        }
    }

    // ─── Cargar mensaje de bienvenida ─────────────────────────────────────────────
    async function loadWelcome() {
        try {
            const res = await fetch(`${AGENT_URL}/chat/welcome?sessionId=${sessionId}`);
            const data = await res.json();
            if (data.response) addMessage(data.response, 'bot');
            if (data.sessionId) sessionId = data.sessionId;
        } catch {
            addMessage(`¡Hola! Soy ${AGENT_NAME}. ¿En qué te puedo ayudar?`, 'bot');
        }
    }

    // ─── Enviar mensaje ───────────────────────────────────────────────────────────
    async function sendMessage() {
        const text = inputEl.value.trim();
        if (!text || isTyping) return;

        inputEl.value = '';
        inputEl.style.height = 'auto';
        addMessage(text, 'user');
        showTyping();

        try {
            const res = await fetch(`${AGENT_URL}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, sessionId }),
            });
            const data = await res.json();
            hideTyping();
            if (data.response) addMessage(data.response, 'bot');
            if (data.sessionId) sessionId = data.sessionId;
        } catch (err) {
            hideTyping();
            addMessage('No pude conectarme con el agente. Verificá que el servidor esté activo.', 'bot');
        }
    }

    // ─── Eventos ──────────────────────────────────────────────────────────────────
    chatBtn.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);
    sendBtn.addEventListener('click', sendMessage);

    inputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
    });

    // Exponer API pública
    window.AgentWidget = {
        open: () => { if (!isOpen) toggleChat(); },
        close: () => { if (isOpen) toggleChat(); },
        setSession: (id) => { sessionId = id; },
        sendMessage,
    };

})();
