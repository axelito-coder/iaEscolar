require('dotenv').config();
const express  = require('express');
const { Pool } = require('pg');
const cors     = require('cors');
const Groq     = require('groq-sdk');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const path     = require('path');

const app  = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// =============================================
//  RUTAS DE PÁGINAS
// =============================================
app.get('/',           (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));
app.get('/login',      (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/admin',      (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// =============================================
//  CONEXIÓN A POSTGRESQL
// =============================================
const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error al conectar con PostgreSQL:', err.message);
  } else {
    console.log('✅ Conectado a PostgreSQL —', process.env.DB_NAME);
    release();
  }
});

// =============================================
//  MIDDLEWARE — verificar JWT
// =============================================
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido.' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'secreto_tecnica6');
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

// =============================================
//  AUTH — POST /api/login
// =============================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Faltan usuario o contraseña.' });

  try {
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE username = $1', [username]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

    const token = jwt.sign(
      { id: user.id, username: user.username, rol: user.rol },
      process.env.JWT_SECRET || 'secreto_tecnica6',
      { expiresIn: '8h' }
    );
    res.json({ token, username: user.username, rol: user.rol });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno.' });
  }
});

// =============================================
//  HELPER — búsqueda full-text con índice GIN
// =============================================
async function obtenerContexto(preguntaUsuario) {
  try {
    const fullText = await pool.query(`
      SELECT pregunta, respuesta, categoria
      FROM preguntas
      WHERE activa = TRUE AND
        to_tsvector('spanish', pregunta || ' ' || respuesta)
        @@ plainto_tsquery('spanish', $1)
      LIMIT 5
    `, [preguntaUsuario]);

    if (fullText.rows.length > 0) return formatearContexto(fullText.rows);

    const palabras = preguntaUsuario.split(' ').filter(p => p.length > 3);
    if (!palabras.length) return null;

    const ilike = await pool.query(`
      SELECT pregunta, respuesta, categoria FROM preguntas
      WHERE activa = TRUE AND (
        ${palabras.map((_, i) => `pregunta ILIKE $${i+1} OR respuesta ILIKE $${i+1}`).join(' OR ')}
      ) LIMIT 5
    `, palabras.map(p => `%${p}%`));

    return ilike.rows.length ? formatearContexto(ilike.rows) : null;
  } catch (err) {
    console.warn('⚠️ Error al consultar la BD:', err.message);
    return null;
  }
}

function formatearContexto(rows) {
  return rows.map(r => `[${r.categoria}]\nP: ${r.pregunta}\nR: ${r.respuesta}`).join('\n\n');
}

// =============================================
//  CHAT — POST /api/chat (público)
// =============================================
app.post('/api/chat', async (req, res) => {
  const { mensaje, historial = [] } = req.body;
  if (!mensaje?.trim()) return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });

  const contexto = await obtenerContexto(mensaje);

  const systemPrompt = `
Sos el asistente virtual de la Escuela Técnica N°6 de Morón.
Respondés preguntas sobre la institución: inscripciones, especialidades,
horarios, talleres, normas de convivencia, pasantías, evaluación y más.
Respondé siempre en español, de forma clara, amable y concisa.
Si no tenés información suficiente, indicá que consulten directamente con secretaría o preceptoría.
No inventes datos ni fechas; si algo no está en el contexto, decilo.
${contexto
  ? `\nInformación relevante de la base de datos:\n\n${contexto}`
  : '\nNo se encontró información específica. Respondé con criterio general o pedí que contacten a la escuela.'}
`.trim();

  try {
    const completion = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      temperature: 0.4,
      max_tokens:  1024,
      messages: [
        { role: 'system', content: systemPrompt },
        ...historial.slice(-10),
        { role: 'user',   content: mensaje },
      ],
    });
    res.json({ respuesta: completion.choices[0].message.content });
  } catch (err) {
    console.error('❌ Error con Groq:', err.message);
    res.status(500).json({ error: 'Error al procesar el mensaje.' });
  }
});

// =============================================
//  PREGUNTAS — rutas protegidas con authMiddleware
// =============================================

// GET /api/preguntas
app.get('/api/preguntas', authMiddleware, async (req, res) => {
  try {
    const { categoria } = req.query;
    const query  = categoria
      ? 'SELECT * FROM preguntas WHERE categoria ILIKE $1 ORDER BY id ASC'
      : 'SELECT * FROM preguntas ORDER BY id ASC';
    const params = categoria ? [`%${categoria}%`] : [];
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener preguntas.' });
  }
});

// GET /api/categorias
app.get('/api/categorias', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT categoria FROM preguntas ORDER BY categoria ASC');
    res.json(result.rows.map(r => r.categoria));
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener categorías.' });
  }
});

// POST /api/preguntas
app.post('/api/preguntas', authMiddleware, async (req, res) => {
  const { pregunta, respuesta, categoria } = req.body;
  if (!pregunta || !respuesta || !categoria)
    return res.status(400).json({ error: 'Faltan campos.' });
  try {
    const result = await pool.query(
      'INSERT INTO preguntas (pregunta, respuesta, categoria) VALUES ($1, $2, $3) RETURNING *',
      [pregunta, respuesta, categoria]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al insertar.' });
  }
});

// PUT /api/preguntas/:id
app.put('/api/preguntas/:id', authMiddleware, async (req, res) => {
  const { pregunta, respuesta, categoria } = req.body;
  if (!pregunta || !respuesta || !categoria)
    return res.status(400).json({ error: 'Faltan campos.' });
  try {
    const result = await pool.query(
      'UPDATE preguntas SET pregunta=$1, respuesta=$2, categoria=$3 WHERE id=$4 RETURNING *',
      [pregunta, respuesta, categoria, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar.' });
  }
});

// PATCH /api/preguntas/:id (toggle activa)
app.patch('/api/preguntas/:id', authMiddleware, async (req, res) => {
  const { activa } = req.body;
  try {
    const result = await pool.query(
      'UPDATE preguntas SET activa=$1 WHERE id=$2 RETURNING *',
      [activa, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar.' });
  }
});

// DELETE /api/preguntas/:id
app.delete('/api/preguntas/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM preguntas WHERE id=$1', [req.params.id]);
    res.json({ mensaje: 'Eliminado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar.' });
  }
});

// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));