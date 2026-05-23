import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const app = express();
const client = new Anthropic();

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
    spelling: {
      type: 'string',
      description: 'Letter-by-letter spelling for TTS, capitals separated by "... ". Example: "B... E... A... R."'
    },
    sentence: {
      type: 'string',
      description: 'Short (4-8 words), concrete example sentence using the word.'
    },
    meaning: {
      type: 'string',
      description: '5-12 word plain-language explanation for a young child.'
    },
    homophones: {
      type: 'array',
      items: { type: 'string' },
      description: 'Other words that sound the same but are spelled differently. Lowercase. Empty array if none.'
    }
  },
  required: ['spelling', 'sentence', 'meaning', 'homophones'],
  additionalProperties: false
};

const wordCache = new Map();

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
  if (!word || word.length > 40) {
    return res.status(400).json({ error: 'invalid_word' });
  }

  const cached = wordCache.get(word);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 500,
      system: [{
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
      }],
      output_config: {
        format: { type: 'json_schema', schema: RESPONSE_SCHEMA }
      },
      messages: [{ role: 'user', content: word }]
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock?.text) throw new Error('no_text_block');
    const data = JSON.parse(textBlock.text);
    wordCache.set(word, data);
    res.json({ ...data, cached: false });
  } catch (err) {
    console.error('[api/word]', word, err?.message || err);
    res.status(502).json({ error: 'coach_unavailable', detail: err?.message });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true, words_cached: wordCache.size }));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Say & See listening on :${PORT}`);
});
