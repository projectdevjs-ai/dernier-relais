// Génère la voix du narrateur du prologue (la seule voix enregistrée du jeu) avec Fish Audio, modèle gratuit.
// Clé lue dans FISH_KEY, jamais dans le dépôt. Usage : FISH_KEY=... node_modules/.bin/tsx scripts/voix.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { hash } from '../src/core/geo';

// Les phrases sont celles de NARRATION (src/intro/prologue.ts), recopiées dans scripts/voix-extra.json (un test le vérifie).
const NARRATION = (JSON.parse(readFileSync('scripts/voix-extra.json', 'utf8')) as { who: string; text: string }[]).filter(l => l.who === 'narrateur');
const VOICE = '081eafb4e2974f68b5b13d20b8f5995f'; // narrateur : voix masculine grave et posée
const key = process.env.FISH_KEY;
if (!key) throw new Error('FISH_KEY manquante');
mkdirSync('public/voix', { recursive: true });
const ids: string[] = [];
for (const { who, text } of NARRATION) {
  const id = `${who}-${hash(`${who}|${text}`).toString(36)}`, file = `public/voix/${id}.mp3`;
  ids.push(id);
  if (existsSync(file)) continue;
  const r = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model: 's2.1-pro-free' },
    body: JSON.stringify({ text, reference_id: VOICE, format: 'mp3', mp3_bitrate: 128, normalize: true, latency: 'normal' }),
  });
  if (!r.ok) { console.log('échec', r.status, id, (await r.text()).slice(0, 120)); continue; }
  writeFileSync(file, Buffer.from(await r.arrayBuffer())); console.log('ok', id, text);
}
// Les anciennes voix des personnages sont retirées.
for (const f of readdirSync('public/voix')) if (f.endsWith('.mp3') && !ids.includes(f.slice(0, -4))) unlinkSync(`public/voix/${f}`);
writeFileSync('public/voix/index.json', JSON.stringify(ids.sort()));
console.log('total', ids.length);
