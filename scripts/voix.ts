// Génère les voix françaises du jeu avec Fish Audio (modèle gratuit). Clé lue dans FISH_KEY, jamais dans le dépôt.
// Usage : FISH_KEY=... node_modules/.bin/tsx scripts/voix.ts   (ne régénère pas les fichiers déjà présents)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hash } from '../src/core/geo';
import { LINES } from '../src/game/npc';
import { FIRST, POOL } from '../src/lab/texts';

const VOICES: Record<string, string> = {
  narrateur: '081eafb4e2974f68b5b13d20b8f5995f',
  mara: 'a288bdc744da4ad194921adad6863175',
  tomas: 'f315cac8d48d4449ad73ac0f96099acd',
  agathe: '5567200c7d8341738f0892bbacd3be3c',
  kenji: '588134063cd047ffafc43114f3f26746',
  iris: '656cde69eff3483b933b8d2ffd388c3c',
  noe: 'cb16719eac614d8bbc9d7913cc410552',
  selma: 'c100ccdc6297427a90916fd2c63d4966',
};
const jobs: { who: string; text: string }[] = [];
for (const [npc, sit] of Object.entries(LINES)) for (const list of Object.values(sit)) for (const text of list) jobs.push({ who: npc, text });
for (const [who, text] of Object.entries(FIRST)) jobs.push({ who, text });
for (const [who, list] of Object.entries(POOL)) for (const text of list) jobs.push({ who, text });
const extra = 'scripts/voix-extra.json'; // répliques hors code : [{ who, text }]
if (existsSync(extra)) jobs.push(...JSON.parse(readFileSync(extra, 'utf8')));

const key = process.env.FISH_KEY;
if (!key) throw new Error('FISH_KEY manquante');
const index: Record<string, string> = {};
const idOf = (who: string, text: string) => `${who}-${hash(`${who}|${text}`).toString(36)}`;
async function one(j: { who: string; text: string }): Promise<void> {
  const id = idOf(j.who, j.text), file = `public/voix/${id}.mp3`;
  index[id] = j.text;
  if (existsSync(file)) return;
  for (let tryN = 0; tryN < 4; tryN++) {
    const r = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model: 's2.1-pro-free' },
      body: JSON.stringify({ text: j.text, reference_id: VOICES[j.who], format: 'mp3', mp3_bitrate: 64, normalize: true, latency: 'normal' }),
    });
    if (r.ok) { writeFileSync(file, Buffer.from(await r.arrayBuffer())); console.log('ok', id); return; }
    console.log('échec', r.status, id, (await r.text()).slice(0, 120));
    if (r.status !== 429 && r.status < 500) return;
    await new Promise(res => setTimeout(res, 8000 * (tryN + 1)));
  }
}
mkdirSync('public/voix', { recursive: true });
for (let i = 0; i < jobs.length; i += 2) await Promise.all(jobs.slice(i, i + 2).map(one));
writeFileSync('public/voix/index.json', JSON.stringify(Object.keys(index).sort()));
console.log('total', Object.keys(index).length);
