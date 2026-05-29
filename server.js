// =============================================
//  BACKEND — server.js
//  Instalá las dependencias:
//  npm install express pg cors dotenv groq-sdk
//  Luego: node server.js
// =============================================

require('dotenv').config();
const express  = require('express');
const { Pool } = require('pg');
const cors     = require('cors');
const Groq     = require('groq-sdk');

const app  = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json());

const path = require('path');

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'chat.html'));
});

// =============================================
//  CONEXIÓN A POSTGRESQL
// =============================================
const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
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
//  HELPER — búsqueda full-text con el índice GIN
//  Usa el índice español que ya tenés creado.
//  Si no hay coincidencias exactas, hace un
//  fallback con ILIKE para no dejar respuestas vacías.
// =============================================
async function obtenerContexto(preguntaUsuario) {
  try {
    // Intento 1: búsqueda full-text con el índice GIN (más precisa)
    const fullText = await pool.query(`
      SELECT pregunta, respuesta, categoria
      FROM preguntas
      WHERE
        activa = TRUE AND
        to_tsvector('spanish', pregunta || ' ' || respuesta)
        @@ plainto_tsquery('spanish', $1)
      LIMIT 5
    `, [preguntaUsuario]);

    if (fullText.rows.length > 0) {
      return formatearContexto(fullText.rows);
    }

    // Intento 2: fallback con ILIKE si el full-text no encuentra nada
    const palabras = preguntaUsuario.split(' ').filter(p => p.length > 3);
    if (!palabras.length) return null;

    const ilike = await pool.query(`
      SELECT pregunta, respuesta, categoria
      FROM preguntas
      WHERE
        activa = TRUE AND (
          ${palabras.map((_, i) => `pregunta ILIKE $${i + 1} OR respuesta ILIKE $${i + 1}`).join(' OR ')}
        )
      LIMIT 5
    `, palabras.map(p => `%${p}%`));

    return ilike.rows.length ? formatearContexto(ilike.rows) : null;

  } catch (err) {
    console.warn('⚠️  Error al consultar la BD:', err.message);
    return null;
  }
}

function formatearContexto(rows) {
  return rows
    .map(r => `[${r.categoria}]\nP: ${r.pregunta}\nR: ${r.respuesta}`)
    .join('\n\n');
}

// =============================================
//  RUTA — POST /api/chat
//  Body: { mensaje: string, historial: array }
//  historial = [{ role: 'user'|'assistant', content: string }]
// =============================================
app.post('/api/chat', async (req, res) => {
  const { mensaje, historial = [] } = req.body;

  if (!mensaje?.trim()) {
    return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
  }

  const contexto = await obtenerContexto(mensaje);

  const systemPrompt = `
Sos el asistente virtual de la Escuela Técnica N°6 de Morón.
Respondés preguntas sobre la institución: inscripciones, especialidades,
horarios, talleres, normas de convivencia, pasantías, evaluación y más.
Respondé siempre en español, de forma clara, amable y concisa.
Si no tenés información suficiente, indicá que consulten directamente
con secretaría o preceptoría de la escuela.
No inventes datos ni fechas; si algo no está en el contexto, decilo.

${contexto
  ? `Información relevante encontrada en la base de datos:\n\n${contexto}`
  : 'No se encontró información específica en la base de datos para esta consulta. Respondé con criterio general sobre escuelas técnicas o pedí que contacten a la escuela.'}
`.trim();

  try {
    const completion = await groq.chat.completions.create({
      model:       'llama3-8b-8192',
      temperature: 0.4,
      max_tokens:  1024,
      messages: [
        { role: 'system',    content: systemPrompt },
        ...historial.slice(-10), // últimos 10 mensajes para no exceder el contexto
        { role: 'user',      content: mensaje },
      ],
    });

    const respuesta = completion.choices[0].message.content;
    res.json({ respuesta });

  } catch (err) {
    console.error('❌ Error con Groq:', err.message);
    res.status(500).json({ error: 'Error al procesar el mensaje.' });
  }
});

// =============================================
//  RUTAS — CRUD de preguntas (panel admin)
// =============================================

// GET /api/preguntas?categoria=Inscripciones
app.get('/api/preguntas', async (req, res) => {
  try {
    const { categoria } = req.query;
    const query = categoria
      ? 'SELECT * FROM preguntas WHERE categoria ILIKE $1 ORDER BY id ASC'
      : 'SELECT * FROM preguntas ORDER BY id ASC';
    const params = categoria ? [`%${categoria}%`] : [];
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener preguntas.' });
  }
});

// GET /api/categorias → lista de categorías únicas
app.get('/api/categorias', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT categoria FROM preguntas ORDER BY categoria ASC'
    );
    res.json(result.rows.map(r => r.categoria));
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener categorías.' });
  }
});

// POST /api/preguntas → agregar nueva pregunta
app.post('/api/preguntas', async (req, res) => {
  const { pregunta, respuesta, categoria } = req.body;
  if (!pregunta || !respuesta || !categoria) {
    return res.status(400).json({ error: 'Faltan campos: pregunta, respuesta y categoria.' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO preguntas (pregunta, respuesta, categoria) VALUES ($1, $2, $3) RETURNING *',
      [pregunta, respuesta, categoria]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al insertar pregunta.' });
  }
});

// PATCH /api/preguntas/:id → activar/desactivar
app.patch('/api/preguntas/:id', async (req, res) => {
  const { activa } = req.body;
  try {
    const result = await pool.query(
      'UPDATE preguntas SET activa = $1 WHERE id = $2 RETURNING *',
      [activa, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar.' });
  }
});

// DELETE /api/preguntas/:id → eliminar
app.delete('/api/preguntas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM preguntas WHERE id = $1', [req.params.id]);
    res.json({ mensaje: 'Eliminado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar.' });
  }
});

// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});