// One-shot batch pre-warm: read words.json, ask Claude for each missing word,
// store the result in Postgres. Idempotent — run after a deploy or whenever you
// edit words.json. Run with: docker exec <container> node prewarm.js
//
// Concurrency capped at 5 to stay polite with the Anthropic API and let the
// structured-output schema cache warm up after the first response.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coachWord, initDb } from './coach.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONCURRENCY = 5;

async function main() {
  await initDb();
  const raw = await fs.readFile(path.join(__dirname, 'words.json'), 'utf8');
  const groups = JSON.parse(raw);
  const allWords = [...new Set(
    Object.values(groups).flat().map((w) => String(w).trim().toLowerCase()).filter(Boolean)
  )];
  console.log(`pre-warming ${allWords.length} words at concurrency ${CONCURRENCY}…`);

  let done = 0, fromCache = 0, fromApi = 0, failed = 0;
  let i = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= allWords.length) return;
      const word = allWords[idx];
      try {
        const result = await coachWord(word);
        if (result.source === 'api') fromApi++; else fromCache++;
        done++;
        if (done % 25 === 0 || done === allWords.length) {
          console.log(`  ${done}/${allWords.length}  (api=${fromApi}, cached=${fromCache}, failed=${failed})`);
        }
      } catch (err) {
        failed++;
        console.error(`  ! ${word}:`, err?.message || err);
      }
    }
  });
  await Promise.all(workers);
  console.log(`done. api=${fromApi}, already-cached=${fromCache}, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('prewarm failed:', err);
  process.exit(1);
});
