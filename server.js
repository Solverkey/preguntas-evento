const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// Railway inyecta DATABASE_URL automáticamente al añadir el plugin de Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Preparar tablas ----------
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      ts BIGINT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  await pool.query(`
    INSERT INTO state (key, value) VALUES ('featured', '')
    ON CONFLICT (key) DO NOTHING;
  `);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- API ----------

// Obtener todas las preguntas
app.get("/api/questions", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, text, ts FROM questions ORDER BY ts ASC");
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron cargar las preguntas" });
  }
});

// Enviar una pregunta nueva
app.post("/api/questions", async (req, res) => {
  const text = (req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Falta el texto de la pregunta" });
  if (text.length > 240) return res.status(400).json({ error: "Pregunta demasiado larga" });

  const question = { id: uid(), text, ts: Date.now() };
  try {
    await pool.query("INSERT INTO questions (id, text, ts) VALUES ($1, $2, $3)", [
      question.id, question.text, question.ts,
    ]);
    res.json(question);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo guardar la pregunta" });
  }
});

// Descartar una pregunta
app.delete("/api/questions/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM questions WHERE id = $1", [req.params.id]);
    const { rows } = await pool.query("SELECT value FROM state WHERE key = 'featured'");
    if (rows[0]?.value === req.params.id) {
      await pool.query("UPDATE state SET value = '' WHERE key = 'featured'");
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo descartar la pregunta" });
  }
});

// Ver cuál está destacada
app.get("/api/featured", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM state WHERE key = 'featured'");
    res.json({ id: rows[0]?.value || "" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo consultar la pregunta destacada" });
  }
});

// Marcar una pregunta como destacada (o "" para quitarla)
app.post("/api/featured", async (req, res) => {
  const id = req.body.id || "";
  try {
    await pool.query("UPDATE state SET value = $1 WHERE key = 'featured'", [id]);
    res.json({ id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo actualizar la pregunta destacada" });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));
  })
  .catch((e) => {
    console.error("No se pudo inicializar la base de datos", e);
    process.exit(1);
  });
