const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_LEN = 2000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const ESTADOS_VALIDOS = ["pendiente", "pantalla", "cola", "respondida", "descartada"];
const sseClients = new Set();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function broadcast(type) {
  const payload = `data: ${JSON.stringify({ type: type || "update" })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      ts BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendiente'
    );
  `);
  await pool.query(
    `ALTER TABLE questions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendiente';`
  );
  await pool.query(
    `ALTER TABLE questions ADD COLUMN IF NOT EXISTS screen_ts BIGINT;`
  );
}

app.get("/api/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("data: {\"type\":\"hello\"}\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

app.get("/api/questions", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, text, ts, status, screen_ts FROM questions ORDER BY ts ASC"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron cargar las preguntas" });
  }
});

app.post("/api/questions", async (req, res) => {
  const text = String((req.body && req.body.text) || "").trim();
  if (!text) return res.status(400).json({ error: "Falta el texto de la pregunta" });
  if (text.length > MAX_LEN) {
    return res.status(400).json({ error: "Pregunta demasiado larga" });
  }

  const q = { id: uid(), text, ts: Date.now(), status: "pendiente" };
  try {
    await pool.query(
      "INSERT INTO questions (id, text, ts, status) VALUES ($1, $2, $3, $4)",
      [q.id, q.text, q.ts, q.status]
    );
    broadcast("new");
    res.json(q);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo guardar la pregunta" });
  }
});

app.post("/api/questions/:id/status", async (req, res) => {
  const { status, ahora } = req.body || {};
  if (!ESTADOS_VALIDOS.includes(status)) {
    return res.status(400).json({ error: "Estado no válido" });
  }
  try {
    if (status === "pantalla" || status === "cola") {
      const screenTs = Date.now();
      if (status === "pantalla") {
        await pool.query(
          `UPDATE questions
           SET status = 'cola',
               screen_ts = COALESCE(screen_ts, $2) - 1
           WHERE status = 'pantalla' AND id <> $1`,
          [req.params.id, screenTs]
        );
      }
      const result = await pool.query(
        "UPDATE questions SET status = $1, screen_ts = $2 WHERE id = $3",
        [status, screenTs, req.params.id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Pregunta no encontrada" });
      }
    } else {
      const result = await pool.query(
        "UPDATE questions SET status = $1 WHERE id = $2",
        [status, req.params.id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Pregunta no encontrada" });
      }
    }
    broadcast();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo actualizar la pregunta" });
  }
});

app.get("/moderacion", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/proyeccion", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));
  })
  .catch((e) => {
    console.error("No se pudo inicializar la base de datos", e);
    process.exit(1);
  });
