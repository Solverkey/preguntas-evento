const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ESTADOS_VALIDOS = ["pendiente", "pantalla", "respondida", "descartada"];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      ts BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendiente'
    );
  `);
  // Por si la tabla ya existía de una versión anterior sin esta columna
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendiente';`);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Obtener todas las preguntas activas (no descartadas)
app.get("/api/questions", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, text, ts, status FROM questions WHERE status != 'descartada' ORDER BY ts ASC"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron cargar las preguntas" });
  }
});

// Enviar una pregunta nueva (entra siempre como "pendiente")
app.post("/api/questions", async (req, res) => {
  const text = (req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Falta el texto de la pregunta" });
  if (text.length > 240) return res.status(400).json({ error: "Pregunta demasiado larga" });

  const q = { id: uid(), text, ts: Date.now(), status: "pendiente" };
  try {
    await pool.query(
      "INSERT INTO questions (id, text, ts, status) VALUES ($1, $2, $3, $4)",
      [q.id, q.text, q.ts, q.status]
    );
    res.json(q);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo guardar la pregunta" });
  }
});

// Cambiar el estado de una pregunta (aprobar / descartar / marcar respondida / devolver)
app.post("/api/questions/:id/status", async (req, res) => {
  const { status } = req.body;
  if (!ESTADOS_VALIDOS.includes(status)) {
    return res.status(400).json({ error: "Estado no válido" });
  }
  try {
    await pool.query("UPDATE questions SET status = $1 WHERE id = $2", [status, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo actualizar la pregunta" });
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
