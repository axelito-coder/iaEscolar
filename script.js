
  const API = 'http://localhost:3000';
  let historial = [];

  // ── Helpers ──────────────────────────────────
  function hora() {
    return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  function scrollAbajo() {
    const chat = document.getElementById('chat');
    chat.scrollTop = chat.scrollHeight;
  }

  function agregarMensaje(rol, texto) {
    const chat = document.getElementById('chat');

    // Quitar bienvenida si existe
    const welcome = chat.querySelector('.welcome');
    if (welcome) welcome.remove();

    const esUsuario = rol === 'user';
    const wrap = document.createElement('div');
    wrap.className = `msg ${esUsuario ? 'user' : 'bot'}`;

    wrap.innerHTML = `
      <div class="avatar">${esUsuario ? 'Vos' : 'T6'}</div>
      <div>
        <div class="bubble">${texto.replace(/\n/g, '<br>')}</div>
        <div class="timestamp">${hora()}</div>
      </div>
    `;

    chat.appendChild(wrap);
    scrollAbajo();
    return wrap;
  }

  function mostrarTyping() {
    const chat = document.getElementById('chat');
    const wrap = document.createElement('div');
    wrap.className = 'msg bot typing';
    wrap.id = 'typing';
    wrap.innerHTML = `
      <div class="avatar">T6</div>
      <div class="bubble">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    `;
    chat.appendChild(wrap);
    scrollAbajo();
  }

  function quitarTyping() {
    document.getElementById('typing')?.remove();
  }

  // ── Enviar mensaje ────────────────────────────
  async function enviar() {
    const input  = document.getElementById('input');
    const btn    = document.getElementById('sendBtn');
    const texto  = input.value.trim();
    if (!texto) return;

    input.value = '';
    input.style.height = 'auto';
    btn.disabled = true;

    agregarMensaje('user', texto);
    historial.push({ role: 'user', content: texto });
    mostrarTyping();

    try {
      const res = await fetch(`${API}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mensaje: texto, historial }),
      });

      const data = await res.json();
      quitarTyping();

      if (!res.ok) throw new Error(data.error || 'Error del servidor');

      agregarMensaje('bot', data.respuesta);
      historial.push({ role: 'assistant', content: data.respuesta });

    } catch (err) {
      quitarTyping();
      agregarMensaje('bot', '⚠️ No pude conectarme con el servidor. Verificá que esté corriendo en el puerto 3000.');
      console.error(err);
    }

    btn.disabled = false;
    input.focus();
  }

  function enviarChip(chip) {
    document.getElementById('input').value = chip.textContent.replace(/^..\s/, '');
    enviar();
  }

  // ── Enter para enviar (Shift+Enter = salto de línea) ──
  document.getElementById('input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  });

  // ── Autoresize del textarea ───────────────────
  document.getElementById('input').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });