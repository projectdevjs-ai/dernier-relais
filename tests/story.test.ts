// Histoire principale : déroulé du chapitre 1, rattrapage, cadence des messages radio, mémoire, voix, chapitres 2 à 4.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeliveryResult, GameEvent, GameView, OrderView, ShelterView } from '../src/game/api';
import { AFTER, CHAPTERS, STATS, allRadio, type Stat } from '../src/story/chapters';
import { RADIO_GAP_MS, STORY_KEY, Story, type StoryEvent } from '../src/story/story';

// ---------- Outils ----------

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

interface World { stars: number[]; deliveries: number; km: number; night: boolean; carried: OrderView[] }
const world = (over: Partial<World> = {}): World => ({ stars: [0, 0, 0, 0, 0, 0], deliveries: 0, km: 0, night: false, carried: [], ...over });

function order(id: string, fragile = false): OrderView {
  return {
    id, name: 'Médicaments', crate: 'carton', weightKg: 3, fragile, at: [0, 0], destId: 's0', destName: 'Abri', destAt: [0, 0],
    state: 'porté', condition: 1, minutesLeft: null, reward: 100, distanceM: 50, inRange: false,
  };
}
function view(w: World): GameView {
  const shelters: ShelterView[] = w.stars.map((stars, i) => ({
    id: `s${i}`, name: `Abri ${i}`, kind: 'soin' as ShelterView['kind'], at: [0, 0], npc: 'mara', stars, points: 0, nextStarAt: null, nextUnlock: null,
    distanceM: 100, inRange: false, deliverable: [], line: '…',
  }));
  return {
    player: {
      at: [0, 0], headingDeg: 0, speedMps: 0, moving: false, mode: 'simulé', level: 1, xp: 0, xpNext: 100, stamina: 1, skillPoints: 0,
      carriedKg: 0, capacityKg: 20, balance: 0, score: 0, deliveries: w.deliveries, distanceKm: w.km,
    },
    scanner: { ready: true, cooldownLeftS: 0, cooldownS: 12, rangeM: 160 },
    weather: { kind: 'clair', windKmh: 5, tempC: 15, night: w.night, sunAltDeg: 30 },
    orders: w.carried, shelters, dangers: [], skills: [], contracts: [], visited: [], loadedCells: [],
  };
}
const result = (over: Partial<DeliveryResult> = {}): DeliveryResult => ({
  orderId: 'o1', orderName: 'Médicaments', shelterId: 's0', shelterName: 'Abri 0', npc: 'mara', grade: 'C', condition: 0.8, onTime: true,
  points: 100, xp: 40, notes: [], starsBefore: 0, starsAfter: 0, unlock: null, levelUp: false, ...over,
});
const delivery = (over: Partial<DeliveryResult> = {}): GameEvent => ({ type: 'delivery', result: result(over) });

/** Une histoire avec horloge factice et journal des événements émis. */
function rig(storage: Storage | null = null) {
  const clock = { t: 1_000_000 };
  const story = new Story({ storage, now: () => clock.t });
  const log: StoryEvent[] = [];
  story.on(e => log.push(e));
  const w = world();
  return {
    story, log, w, clock,
    radios: () => log.filter((e): e is Extract<StoryEvent, { type: 'radio' }> => e.type === 'radio').map(e => e.text),
    /** Laisse passer du temps, en observant cinq fois par seconde comme le jeu. */
    wait(s: number) { for (let i = 0; i < s * 5; i++) { clock.t += 200; story.observe(view(w)); } },
    tick() { story.observe(view(w)); },
  };
}

/** Événements du contrat qui font monter chaque compteur d'une unité (ou la vue, pour les compteurs lus dans la vue). */
const BUMP: Record<Stat, (r: ReturnType<typeof rig>) => void> = {
  scans: r => r.story.handle({ type: 'scan', found: 1 }),
  ramassages: r => r.story.handle({ type: 'pickup', order: order('p') }),
  livraisons: r => r.story.handle(delivery()),
  notesA: r => r.story.handle(delivery({ grade: 'A' })),
  notesS: r => r.story.handle(delivery({ grade: 'S' })),
  fragiles: r => { r.story.handle({ type: 'pickup', order: order('f', true) }); r.story.handle(delivery({ orderId: 'f', condition: 0.95 })); },
  rudes: r => r.story.handle(delivery({ notes: ['De nuit'] })),
  relies: r => { r.w.stars[r.w.stars.findIndex(s => s === 0)] = 1; r.tick(); },
  abris3: r => { r.w.stars[0] = Math.max(r.w.stars[0], 3); r.tick(); },
  abris5: r => { r.w.stars[0] = 5; r.tick(); },
  ecoutes: r => r.story.handle({ type: 'inspect', order: order('i'), xp: 5 }),
  arrimages: r => r.story.handle({ type: 'strap', orderId: 'p', quality: 0.9, xp: 5 }),
  caches: r => r.story.handle({ type: 'cache', cacheId: 'k', points: 10, xp: 5, skillPoint: false }),
  rencontres: r => r.story.handle({ type: 'wanderer', id: 'w', name: 'Lina', line: '…', gift: 'xp' }),
  fronts: r => { r.story.handle({ type: 'front', phase: 'entrée' }); r.story.handle({ type: 'front', phase: 'sortie' }); },
  perdus: r => r.story.handle(delivery({ lostBy: 'Sam' })),
  speciaux: r => r.story.handle(delivery({ special: 'ruche' })),
  lots: r => r.story.handle({ type: 'jam', phase: 'réussi', bonus: 100, jam: { id: 'j', shelterId: 's0', shelterName: 'Abri 0', at: [0, 0], state: 'en cours', count: 3, delivered: 3, minutes: 20, minutesLeft: 2, bonus: 100, distanceM: 0, inRange: true } }),
  preuves: r => r.story.handle({ type: 'proof', orderId: 'o1', points: 10 }),
  km: r => { r.w.km += 1; r.tick(); },
};

// ---------- Chapitre 1 ----------

describe('chapitre 1', () => {
  it('se déroule étape par étape, avec un message à l’activation et un à l’achèvement', () => {
    const r = rig();
    const c1 = CHAPTERS[0];
    r.wait(3);
    expect(r.story.state()).toMatchObject({ chapter: 1, step: 1, stepCount: 8, objective: 'Lance le scanner', finished: false });
    expect(r.radios()).toEqual([c1.steps[0].start.text]);

    const acts: (() => void)[] = [
      () => r.story.handle({ type: 'scan', found: 2 }),
      () => r.story.handle({ type: 'pickup', order: order('o1') }),
      () => { r.w.stars[0] = 1; r.w.deliveries = 1; r.story.handle(delivery({ starsAfter: 1 })); },
      () => { r.w.deliveries = 2; r.story.handle(delivery({ grade: 'A' })); },
      () => { r.w.stars[1] = 1; r.w.deliveries = 3; r.story.handle(delivery({ shelterId: 's1', starsAfter: 1 })); },
      () => { r.story.handle({ type: 'pickup', order: order('o6', true) }); r.w.deliveries = 4; r.story.handle(delivery({ orderId: 'o6', condition: 0.96 })); },
      () => { r.w.night = true; r.tick(); r.w.deliveries = 5; r.story.handle(delivery()); },
      () => { r.w.stars[2] = 1; r.w.deliveries = 6; r.story.handle(delivery({ shelterId: 's2', starsAfter: 1 })); },
    ];
    acts.forEach((act, i) => {
      expect(r.story.state().stepId).toBe(c1.steps[i].id);
      act();
      r.wait(20); // le temps de laisser passer le message de fin puis celui de l'étape suivante
      expect(r.radios()).toContain(c1.steps[i].done.text);
    });
    // Tous les messages du chapitre, dans l'ordre, puis le premier du chapitre 2.
    const expected = c1.steps.flatMap(s => [s.start.text, s.done.text]);
    expect(r.radios().slice(0, expected.length)).toEqual(expected);
    expect(r.radios()[expected.length]).toBe(CHAPTERS[1].steps[0].start.text);
    // Le carton de fin arrive une fois, après la révélation.
    const cards = r.log.filter(e => e.type === 'chapter');
    expect(cards).toEqual([{ type: 'chapter', chapter: 1, title: 'Premier signal', text: c1.ending, next: CHAPTERS[1].title, silent: false }]);
    const iReveal = r.log.findIndex(e => e.type === 'radio' && e.text === c1.steps[7].done.text);
    expect(r.log.findIndex(e => e.type === 'chapter')).toBeGreaterThan(iReveal);
    expect(r.story.state()).toMatchObject({ chapter: 2, step: 1 });
  });

  it('donne la progression n/m de l’objectif et prévient quand elle bouge', () => {
    const r = rig();
    r.w.stars[0] = 1; r.w.deliveries = 1;
    r.story.handle(delivery({ grade: 'A', starsAfter: 1 }));
    r.wait(1);
    expect(r.story.state()).toMatchObject({ stepId: 'c1-deux', n: 1, m: 2 });
    const j = r.story.journal();
    expect(j[0].steps.map(s => s.status)).toEqual(['faite', 'faite', 'faite', 'faite', 'en cours', 'à venir', 'à venir', 'à venir']);
    expect(j[1].status).toBe('à venir');
    expect(j[0].ending).toBeNull();
  });

  it('accepte les événements dans le désordre', () => {
    const r = rig();
    // Une livraison notée A arrive avant tout scan ou ramassage connus.
    r.story.handle(delivery({ grade: 'S', starsAfter: 1 }));
    expect(r.story.state().stepId).toBe('c1-deux');
    r.story.handle({ type: 'front', phase: 'sortie' }); // sortie sans entrée : pas d'erreur
    r.story.handle({ type: 'drop', orderId: 'inconnu' });
    r.story.handle({ type: 'toast', text: 'x' });
    expect(r.story.state().stepId).toBe('c1-deux');
  });

  it('ne reste pas bloqué sans nuit ni pluie : assez de livraisons de jour suffisent', () => {
    const r = rig();
    r.w.stars = [1, 1, 0, 0, 0, 0];
    r.story.handle({ type: 'pickup', order: order('f', true) });
    r.story.handle(delivery({ orderId: 'f', grade: 'A', condition: 1, starsAfter: 1 }));
    expect(r.story.state().stepId).toBe('c1-deux'); // la vue n'a pas encore été observée : un seul abri connu
    r.tick();
    expect(r.story.state().stepId).toBe('c1-nuit');
    r.w.deliveries = 15; r.tick();
    expect(r.story.state().stepId).toBe('c1-trois');
  });
});

// ---------- Rattrapage et cadence ----------

describe('rattrapage', () => {
  it('passe en silence les étapes déjà remplies et n’annonce que l’étape où le joueur en est', () => {
    const r = rig();
    Object.assign(r.w, { stars: [2, 1, 0, 0, 0, 0], deliveries: 9 });
    r.wait(30);
    // scan, colis, premier abri : déduits de la vue. La note A ne se devine pas.
    expect(r.story.state().stepId).toBe('c1-note');
    expect(r.radios()).toEqual([CHAPTERS[0].steps[3].start.text]);
    const steps = r.log.filter(e => e.type === 'step');
    expect(steps.filter(e => e.type === 'step' && e.silent).length).toBe(3);
  });

  it('un joueur qui a déjà tout fait traverse l’histoire sans message ni carton', () => {
    const r = rig();
    Object.assign(r.w, { stars: [5, 5, 3, 1, 1, 1], deliveries: 120, km: 40 });
    for (let i = 0; i < 3; i++) r.story.handle(delivery({ grade: 'S' }));
    r.story.handle({ type: 'inspect', order: order('i'), xp: 5 });
    for (let i = 0; i < 4; i++) r.story.handle({ type: 'cache', cacheId: 'k', points: 1, xp: 1, skillPoint: false });
    for (let i = 0; i < 4; i++) r.story.handle(delivery({ notes: ['Sous la pluie'] }));
    for (let i = 0; i < 3; i++) r.story.handle({ type: 'strap', orderId: 'o', quality: 1, xp: 5 });
    r.log.length = 0;
    r.wait(60);
    expect(r.story.state()).toMatchObject({ finished: true, objective: AFTER });
    // Seuls d'éventuels messages déjà en file avant la vue ont pu passer : jamais plus d'un par 8 secondes.
    expect(r.radios().length).toBeLessThanOrEqual(1);
    expect(r.log.filter(e => e.type === 'chapter' && !e.silent)).toEqual([]);
    expect(r.story.journal().every(c => c.status === 'faite')).toBe(true);
  });
});

describe('cadence des messages radio', () => {
  it('au plus un message toutes les 8 secondes, les messages périmés sont abandonnés', () => {
    const r = rig();
    const at: number[] = [];
    r.story.on(e => { if (e.type === 'radio') at.push(r.clock.t); });
    r.wait(3);
    // Quatre étapes franchies en moins de deux secondes.
    r.story.handle({ type: 'scan', found: 1 });
    r.wait(0.4);
    r.story.handle({ type: 'pickup', order: order('o1') });
    r.wait(0.4);
    r.w.stars[0] = 1; r.w.deliveries = 1;
    r.story.handle(delivery({ starsAfter: 1 }));
    r.wait(0.4);
    r.story.handle(delivery({ grade: 'A' }));
    r.wait(120);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(RADIO_GAP_MS);
    const said = r.radios();
    const c1 = CHAPTERS[0].steps;
    // Les messages de départ des étapes déjà dépassées ne sont jamais dits.
    expect(said).not.toContain(c1[1].start.text);
    expect(said).not.toContain(c1[2].start.text);
    expect(said).not.toContain(c1[3].start.text);
    // Le message de l'étape en cours finit par passer, et la file ne déverse pas dix messages.
    expect(said[said.length - 1]).toBe(c1[4].start.text);
    expect(said.length).toBeLessThanOrEqual(6);
  });

  it('observe() sans changement n’émet rien', () => {
    const r = rig();
    r.wait(20);
    const n = r.log.length;
    r.wait(60);
    expect(r.log.length).toBe(n);
  });
});

// ---------- Mémoire ----------

describe('persistance', () => {
  it('retrouve la progression après rechargement, sous la clé prévue', () => {
    const mem = new MemStorage();
    const a = rig(mem);
    a.wait(3);
    a.story.handle({ type: 'scan', found: 1 });
    a.story.handle({ type: 'pickup', order: order('o1') });
    a.w.stars[0] = 1; a.w.deliveries = 1;
    a.story.handle(delivery({ grade: 'A', starsAfter: 1 }));
    expect(a.story.state().stepId).toBe('c1-deux');
    expect(STORY_KEY).toBe('dernier-relais/histoire');
    expect(JSON.parse(mem.getItem(STORY_KEY)!)).toMatchObject({ v: 1, c: 0, s: 4 });

    const b = rig(mem);
    expect(b.story.state()).toMatchObject({ stepId: 'c1-deux', n: 1, m: 2 });
    b.wait(30);
    // Au retour, seul le rappel de l'étape en cours est dit.
    expect(b.radios()).toEqual([CHAPTERS[0].steps[4].start.text]);
  });

  it('survit à un stockage absent, en panne ou corrompu', () => {
    expect(() => rig(null).wait(2)).not.toThrow();
    const broken = new MemStorage();
    broken.setItem = () => { throw new Error('plein'); };
    broken.getItem = () => { throw new Error('interdit'); };
    const r = rig(broken);
    expect(() => { r.story.handle({ type: 'scan', found: 1 }); r.wait(2); }).not.toThrow();
    expect(r.story.state().stepId).toBe('c1-colis');
    for (const bad of ['{', '{"v":1,"c":99,"s":-4,"stats":{"scans":"x"}}', '[]', 'null']) {
      const mem = new MemStorage();
      mem.setItem(STORY_KEY, bad);
      const s = rig(mem);
      expect(() => s.wait(2)).not.toThrow();
      expect(s.story.state().objective.length).toBeGreaterThan(0);
    }
  });

  it('reset() repart du début', () => {
    const mem = new MemStorage();
    const r = rig(mem);
    r.story.handle(delivery({ grade: 'A', starsAfter: 1 }));
    r.story.reset();
    expect(r.story.state().stepId).toBe('c1-scan');
    expect(JSON.parse(mem.getItem(STORY_KEY)!)).toMatchObject({ c: 0, s: 0 });
  });
});

// ---------- Textes et voix ----------

describe('textes', () => {
  const sentences = (t: string): number => t.replace(/« [^»]* »/g, 'x').split(/[.!?…]+(?:\s|$)/).filter(s => s.trim()).length;

  it('chaque message radio fait une ou deux phrases, chaque objectif tient en une ligne courte', () => {
    for (const m of allRadio()) {
      expect(sentences(m.text), m.text).toBeLessThanOrEqual(2);
      expect(m.text.length, m.text).toBeLessThanOrEqual(190);
      expect(m.text, m.text).not.toMatch(/'|\p{Extended_Pictographic}/u); // apostrophes typographiques, aucun emoji
    }
    for (const c of CHAPTERS) for (const s of c.steps) expect(s.objective.length, s.objective).toBeLessThanOrEqual(46);
  });

  it('structure : 4 chapitres, 6 à 8 étapes au premier, 4 à 5 ensuite, identifiants uniques', () => {
    expect(CHAPTERS.length).toBe(4);
    expect(CHAPTERS[0].steps.length).toBeGreaterThanOrEqual(6);
    expect(CHAPTERS[0].steps.length).toBeLessThanOrEqual(8);
    for (const c of CHAPTERS.slice(1)) { expect(c.steps.length).toBeGreaterThanOrEqual(4); expect(c.steps.length).toBeLessThanOrEqual(5); }
    const ids = CHAPTERS.flatMap(c => c.steps.map(s => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    const texts = allRadio().map(m => m.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('scripts/voix-extra.json contient exactement les messages radio, plus les lignes du prologue', () => {
    const extra = JSON.parse(readFileSync('scripts/voix-extra.json', 'utf8')) as { who: string; text: string }[];
    for (const j of extra) expect(['iris', 'noe', 'selma', 'narrateur']).toContain(j.who);
    const key = (j: { who: string; text: string }): string => `${j.who}|${j.text}`;
    const radio = allRadio().map(key);
    // Lignes du prologue, lues dans le code source lui-même.
    const src = readFileSync('src/intro/prologue.ts', 'utf8');
    const block = src.slice(src.indexOf('const LINES'), src.indexOf('const CUES'));
    const prologue = [...block.matchAll(/kind: '(?:line|place|title)',(?: kicker: '[^']*',)? text: '([^']+)'/g)].map(m => m[1]);
    expect(prologue.length).toBe(7);
    const rest = extra.filter(j => !radio.includes(key(j)));
    expect(extra.filter(j => radio.includes(key(j))).map(key)).toEqual(radio);
    expect(rest.map(j => j.text)).toEqual(prologue);
    for (const j of rest) expect(['iris', 'narrateur']).toContain(j.who);
  });
});

// ---------- Chapitres 2 à 4 ----------

describe('chapitres 2 à 4', () => {
  it('chaque compteur utilisé par une condition monte avec des événements ou une vue du contrat', () => {
    for (const k of STATS) {
      const r = rig();
      const before = JSON.stringify(r.story.journal());
      // Le compteur doit pouvoir atteindre le plus grand but demandé dans l'histoire.
      const goals = CHAPTERS.flatMap(c => c.steps.flatMap(s => [s.cond, s.orElse])).filter(c => c?.stat === k).map(c => c!.goal);
      if (!goals.length) continue;
      for (let i = 0; i < Math.max(...goals); i++) BUMP[k](r);
      expect(JSON.stringify(r.story.journal()), k).not.toBe(before);
    }
  });

  it('se terminent tous par leur voie principale, puis par leur voie de secours', () => {
    for (const mode of ['cond', 'orElse'] as const) {
      const r = rig();
      r.wait(2);
      for (let guard = 0; guard < 400 && !r.story.state().finished; guard++) {
        const st = r.story.state();
        const step = CHAPTERS[st.chapter - 1].steps[st.step - 1];
        const c = (mode === 'orElse' && step.orElse) || step.cond;
        BUMP[c.stat](r);
        r.tick();
        // En jeu, les étapes ne s'enchaînent pas dans la même seconde : on laisse le message de fin passer.
        if (r.story.state().stepId !== st.stepId) r.wait(20);
      }
      expect(r.story.state().finished, mode).toBe(true);
      r.wait(200);
      if (mode === 'cond') {
        expect(r.log.filter(e => e.type === 'chapter').map(e => e.type === 'chapter' && e.chapter)).toEqual([1, 2, 3, 4]);
        expect(r.radios()).toContain(CHAPTERS[3].steps[4].done.text);
      }
    }
  });
});
