  const API = 'https://tecnica6.onrender.com';

  // Si ya está logueado, redirigir al admin
  if (localStorage.getItem('token')) {
    window.location.href = '/admin.html';
  }

  async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const btn      = document.getElementById('loginBtn');
    const errorMsg = document.getElementById('errorMsg');

    if (!username || !password) {
      mostrarError('Completá usuario y contraseña.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Verificando...';
    errorMsg.classList.remove('visible');

    try {
      const res  = await fetch(`${API}/api/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Credenciales incorrectas');

      localStorage.setItem('token', data.token);
      localStorage.setItem('usuario', data.username);
      window.location.href = '/admin.html';

    } catch (err) {
      mostrarError(err.message);
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  }

  function mostrarError(msg) {
    const el = document.getElementById('errorMsg');
    el.textContent = msg;
    el.classList.add('visible');
  }

  // Enter para login
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });