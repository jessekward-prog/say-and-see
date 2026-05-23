import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';

const client = new Anthropic();

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

const SYSTEM_PROMPT = `You are a warm, encouraging spelling coach for a young child (about 4-6 years old) who is learning to read and write. When given a word, return JSON that helps them learn it.

Rules:
- The example sentence must be short (4-8 words) and concrete: pets, family, food, play, school, weather, bodies, simple feelings.
- The meaning must be 5-12 words in plain language a 5-year-old understands. No metaphors.
- The spelling field is meant to be read aloud by text-to-speech, so separate each letter with "... " (three dots + space) so the TTS pauses on each letter. Capitalise the letters. Example for "bear": "B... E... A... R."
- homophones lists OTHER words that sound the same as the given word (different spellings, different meanings). Empty array if none. Use lowercase. Do not include the word itself.
- Stay kind and encouraging in tone, even though most fields are short.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    spelling: { type: 'string', description: 'Letter-by-letter spelling for TTS, capitals separated by "... ". Example: "B... E... A... R."' },
    sentence: { type: 'string', description: 'Short (4-8 words), concrete example sentence using the word.' },
    meaning: { type: 'string', description: '5-12 word plain-language explanation for a young child.' },
    homophones: { type: 'array', items: { type: 'string' }, description: 'Other words that sound the same but are spelled differently. Lowercase. Empty array if none.' }
  },
  required: ['spelling', 'sentence', 'meaning', 'homophones'],
  additionalProperties: false
};

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
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
    messages: [{ role: 'user', content: word }],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('no_text_block');
  const data = JSON.parse(textBlock.text);
  memCache.set(word, data);
  await dbInsert(word, data);
  return { ...data, source: 'api' };
}

export function memCacheSize() { return memCache.size; }
