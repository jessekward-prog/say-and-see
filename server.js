import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import { pool, initDb, coachWord, memCacheSize } from './coach.js';

const PIPER_CMD   = process.env.PIPER_CMD   || 'piper';
const PIPER_MODEL = process.env.PIPER_MODEL || `${os.homedir()}/.local/share/piper/en/en_GB/cori/high/en_GB-cori-high.onnx`;

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

app.post('/api/speak', async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text || text.length > 500) return res.status(400).json({ error: 'invalid_text' });

  const outFile = path.join(os.tmpdir(), `piper_${randomUUID()}.wav`);
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(PIPER_CMD, ['--model', PIPER_MODEL, '--output_file', outFile]);
      proc.stdin.write(text);
      proc.stdin.end();
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper exited ${code}`))));
      proc.on('error', reject);
    });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-cache');
    const stream = createReadStream(outFile);
    res.on('finish', () => unlink(outFile).catch(() => {}));
    res.on('close',  () => unlink(outFile).catch(() => {}));
    stream.pipe(res);
  } catch (err) {
    console.error('[api/speak]', err?.message || err);
    unlink(outFile).catch(() => {});
    res.status(502).json({ error: 'tts_unavailable', detail: err.message });
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
