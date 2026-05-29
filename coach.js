import pg from 'pg';

const LM_STUDIO_BASE_URL = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
const LM_STUDIO_MODEL   = process.env.LM_STUDIO_MODEL   || 'google/gemma-4-e2b';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS words (
      word TEXT PRIMARY KEY,
      spelling TEXT NOT NULL,
      sentence TEXT NOT NULL,
      meaning TEXT NOT NULL,
      homophones JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

const SYSTEM_PROMPT = `You are a warm, encouraging spelling coach for a young child (about 4-6 years old) who is learning to read and write. When given a word, respond with valid JSON only — no markdown, no explanation, just the JSON object.

Rules:
- The example sentence must be short (4-8 words) and concrete: pets, family, food, play, school, weather, bodies, simple feelings.
- The meaning must be 5-12 words in plain language a 5-year-old understands. No metaphors.
- The spelling field is read aloud by text-to-speech: write each letter separated by ", " so the TTS pauses between letters. Capitalise the letters. Example for "bear": "B, E, A, R"
- homophones lists OTHER words that sound the same as the given word (different spelling, different meaning). Empty array if none. Lowercase. Do not include the word itself.

Respond with exactly this JSON shape:
{"spelling":"...","sentence":"...","meaning":"...","homophones":[...]}`;

// L1 in-process cache. Hits in microseconds. Postgres is L2 (durable across restarts).
const memCache = new Map();

async function dbLookup(word) {
  const { rows } = await pool.query(
    'SELECT spelling, sentence, meaning, homophones FROM words WHERE word = $1',
    [word]
  );
  return rows[0] || null;
}

async function dbInsert(word, data) {
  await pool.query(
    `INSERT INTO words (word, spelling, sentence, meaning, homophones)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (word) DO NOTHING`,
    [word, data.spelling, data.sentence, data.meaning, JSON.stringify(data.homophones)]
  );
}

export async function coachWord(word) {
  if (memCache.has(word)) return { ...memCache.get(word), source: 'mem' };
  const db = await dbLookup(word);
  if (db) {
    memCache.set(word, db);
    return { ...db, source: 'db' };
  }

  const response = await fetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer lm-studio' },
    body: JSON.stringify({
      model: LM_STUDIO_MODEL,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: word },
      ],
    }),
  });

  if (!response.ok) throw new Error(`LM Studio ${response.status}: ${await response.text()}`);
  const json = await response.json();
  const data = JSON.parse(json.choices[0].message.content);
  memCache.set(word, data);
  await dbInsert(word, data);
  return { ...data, source: 'api' };
}

export function memCacheSize() { return memCache.size; }
