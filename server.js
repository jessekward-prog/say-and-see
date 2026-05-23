import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, initDb, coachWord, memCacheSize } from './coach.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const app = express();

app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    const name = path.basename(filePath);
    if (name === 'index.html' || name === 'service-worker.js' || name === 'manifest.webmanifest') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.post('/api/word', async (req, res) => {
  const raw = String(req.body?.word ?? '').trim().toLowerCase();
  const word = raw.replace(/[^a-z'\-]/g, '');
  if (!word || word.length > 40) return res.status(400).json({ error: 'invalid_word' });

  try {
    const data = await coachWord(word);
    res.json(data);
  } catch (err) {
    console.error('[api/word]', word, err?.message || err);
    res.status(502).json({ error: 'coach_unavailable', detail: err?.message });
  }
});

app.get('/healthz', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM words');
    res.json({ ok: true, words_in_db: rows[0].n, words_in_mem: memCacheSize() });
  } catch (err) {
    res.status(503).json({ ok: false, error: err?.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Say & See listening on :${PORT}`));
}).catch((err) => {
  console.error('initDb failed', err);
  process.exit(1);
});
