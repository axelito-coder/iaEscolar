  const API = 'http://localhost:3000';
  const token   = localStorage.getItem('token');
  let preguntas = [];
  let editandoId = null;
  let paginaActual = 1;
  const POR_PAGINA = 15;

  // Guard: si no hay token, redirigir al login
  if (!token) window.location.href = '/login.html';
  document.getElementById('userBadge').textContent = '👤 ' + (localStorage.getItem('usuario') || 'admin');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // ── Cargar datos ──────────────────────────────
  async function cargar() {
    try {
      const res  = await fetch(`${API}/api/preguntas`, { headers });
      if (res.status === 401) { logout(); return; }
      preguntas  = await res.json();
      actualizarStats();
      cargarCategorias();
      filtrar();
    } catch (err) {
      console.error(err);
    }
  }

  function actualizarStats() {
    document.getElementById('statTotal').textContent     = preguntas.length;
    document.getElementById('statActivas').textContent   = preguntas.filter(p => p.activa).length;
    document.getElementById('statCategorias').textContent = [...new Set(preguntas.map(p => p.categoria))].length;
  }

  function cargarCategorias() {
    const cats = [...new Set(preguntas.map(p => p.categoria))].sort();
    const sel  = document.getElementById('filtroCat');
    sel.innerHTML = '<option value="">Todas las categorías</option>';
    cats.forEach(c => sel.innerHTML += `<option value="${c}">${c}</option>`);

    const dl = document.getElementById('catList');
    dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');
  }

  // ── Filtrar y paginar ─────────────────────────
  function filtrar() {
    const busq = document.getElementById('buscar').value.toLowerCase();
    const cat  = document.getElementById('filtroCat').value;
    const filt = preguntas.filter(p =>
      (!busq || p.pregunta.toLowerCase().includes(busq) || p.respuesta.toLowerCase().includes(busq)) &&
      (!cat  || p.categoria === cat)
    );
    paginaActual = 1;
    renderTabla(filt);
  }

  function renderTabla(datos) {
    const total  = datos.length;
    const inicio = (paginaActual - 1) * POR_PAGINA;
    const pagina = datos.slice(inicio, inicio + POR_PAGINA);
    const tbody  = document.getElementById('tablaBody');

    if (!pagina.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No se encontraron resultados.</td></tr>';
      document.getElementById('paginacion').innerHTML = '';
      return;
    }

    tbody.innerHTML = pagina.map(p => `
      <tr>
        <td>${p.id}</td>
        <td class="td-pregunta">${p.pregunta}</td>
        <td class="td-respuesta">${p.respuesta.substring(0, 80)}${p.respuesta.length > 80 ? '…' : ''}</td>
        <td><span class="cat-badge">${p.categoria}</span></td>
        <td>
          <button class="toggle-btn ${p.activa ? 'on' : 'off'}" onclick="toggleActiva(${p.id}, ${p.activa})" title="${p.activa ? 'Desactivar' : 'Activar'}"></button>
        </td>
        <td>
          <div class="actions">
            <button class="btn-edit" onclick="abrirModal(${p.id})">Editar</button>
            <button class="btn-del"  onclick="eliminar(${p.id})">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');

    // Paginación
    const totalPags = Math.ceil(total / POR_PAGINA);
    const pag = document.getElementById('paginacion');
    pag.innerHTML = '';
    for (let i = 1; i <= totalPags; i++) {
      pag.innerHTML += `<button class="page-btn ${i === paginaActual ? 'active' : ''}" onclick="irPagina(${i}, ${JSON.stringify(datos).replace(/"/g, '&quot;')})">${i}</button>`;
    }
  }

  function irPagina(n, datos) {
    paginaActual = n;
    renderTabla(datos);
  }

  // ── Toggle activa ─────────────────────────────
  async function toggleActiva(id, actual) {
    try {
      await fetch(`${API}/api/preguntas/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ activa: !actual }),
      });
      const p = preguntas.find(p => p.id === id);
      if (p) p.activa = !actual;
      actualizarStats();
      filtrar();
    } catch (err) { console.error(err); }
  }

  // ── Eliminar ──────────────────────────────────
  async function eliminar(id) {
    if (!confirm('¿Eliminar esta pregunta? Esta acción no se puede deshacer.')) return;
    try {
      await fetch(`${API}/api/preguntas/${id}`, { method: 'DELETE', headers });
      preguntas = preguntas.filter(p => p.id !== id);
      actualizarStats();
      cargarCategorias();
      filtrar();
    } catch (err) { console.error(err); }
  }

  // ── Modal ─────────────────────────────────────
  function abrirModal(id = null) {
    editandoId = id;
    document.getElementById('modalTitulo').textContent = id ? 'Editar pregunta' : 'Nueva pregunta';
    if (id) {
      const p = preguntas.find(p => p.id === id);
      document.getElementById('mPregunta').value  = p.pregunta;
      document.getElementById('mRespuesta').value = p.respuesta;
      document.getElementById('mCategoria').value = p.categoria;
    } else {
      document.getElementById('mPregunta').value  = '';
      document.getElementById('mRespuesta').value = '';
      document.getElementById('mCategoria').value = '';
    }
    document.getElementById('modal').classList.add('open');
  }

  function cerrarModal() {
    document.getElementById('modal').classList.remove('open');
    editandoId = null;
  }

  async function guardar() {
    const pregunta  = document.getElementById('mPregunta').value.trim();
    const respuesta = document.getElementById('mRespuesta').value.trim();
    const categoria = document.getElementById('mCategoria').value.trim();

    if (!pregunta || !respuesta || !categoria) {
      alert('Completá todos los campos.'); return;
    }

    try {
      if (editandoId) {
        // Editar — usamos POST con flag update por simplicidad
        await fetch(`${API}/api/preguntas/${editandoId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ pregunta, respuesta, categoria }),
        });
      } else {
        await fetch(`${API}/api/preguntas`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ pregunta, respuesta, categoria }),
        });
      }
      cerrarModal();
      cargar();
    } catch (err) { console.error(err); alert('Error al guardar.'); }
  }

  // ── Auth ──────────────────────────────────────
  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    window.location.href = '/login.html';
  }

  // Cerrar modal con Escape
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModal(); });
  // ── Crear usuario ─────────────────────────────
async function crearUsuario() {
  const username = document.getElementById('nuevoUsername').value.trim();
  const password = document.getElementById('nuevoPassword').value.trim();
  const rol      = document.getElementById('nuevoRol').value;
  const msg      = document.getElementById('msgUsuario');

  if (!username || !password) {
    msg.textContent = '⚠️ Completá todos los campos.';
    msg.style.color = 'tomato';
    return;
  }

  try {
    const res  = await fetch(`${API}/api/usuarios`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username, password, rol }),
    });
    const data = await res.json();

    if (!res.ok) {
      msg.textContent = '❌ ' + data.error;
      msg.style.color = 'tomato';
    } else {
      msg.textContent = `✅ Usuario "${data.username}" creado correctamente.`;
      msg.style.color = '#4ade80';
      document.getElementById('nuevoUsername').value = '';
      document.getElementById('nuevoPassword').value = '';
    }
  } catch (err) {
    msg.textContent = '❌ Error de conexión.';
    msg.style.color = 'tomato';
  }
}  
  cargar();