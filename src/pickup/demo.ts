// Démo du ramassage et du rangement, sans carte : chaque étape peut être figée pour une capture.
//   ?etape=reperage|inspection|sanglage|cliquet|rangement|rangement0|rangement2   (sans étape : la séquence complète, jouable)
//   &pano=ville|rural|riviere|plage|friche   décor 360° (sinon la caméra est demandée, puis le décor du colis)
//   &ambiance=clair   &leger=1 (rendu allégé)   &sans3d=1 (sans WebGL : caisse dessinée à plat)
//   &colis=bois|alu|plastique|carton|cryo|ruche|batterie|boitenoire   &kg=7   &fragile=1   &delai=1
//   &boucles=2 (sanglage : boucles déjà reliées)   &defauts=2   &etiquette=1   &ecoute=1   &vise=1 (repérage : colis dans le viseur)
//   &nuit=1 &pluie=1 &fatigue=1   &palier=0..3 (rangement)   &anime=1 (ne fige pas l'image)   &fige=2500 (délai avant de figer, en ms)
import '../ui/hud.css';
import type { CrateKind, GameView, SpecialKind } from '../game/api';
import { Game } from '../game/game';
import { type GameSave, MemoryGameStore, emptyGameSave } from '../game/save';
import { SPECIALS } from '../game/specials';
import { cellAt } from '../core/geo';
import type { LngLat } from '../core/geo';
import type { CellContent, ParcelSpot, Shelter } from '../world/types';
import { PickupFlow, seqParcel } from './flow';
import type { Phase, SeqParcel } from './sequence';
import type { PanoName } from './view3d';

const q = new URLSearchParams(location.search);
const etape = q.get('etape') ?? '';
const clair = q.get('ambiance') === 'clair';
document.body.classList.toggle('clair', clair);
const root = document.getElementById('hud')!;
root.classList.add('dr-hud');
root.dataset.ambiance = clair ? 'clair' : 'crepuscule';

// ----- Un vrai moteur de jeu, sur un tout petit monde -----
const BASE: LngLat = [-1.5761, 47.1822];
const off = (dx: number, dy: number): LngLat => [BASE[0] + dx / (111320 * Math.cos((BASE[1] * Math.PI) / 180)), BASE[1] + dy / 110540];
const shelter = (id: string, at: LngLat, name: string): Shelter => ({ id, cell: cellAt(at[0], at[1]).id, name, kind: 'soin', at, source: 'lieu' });
const shelters = [shelter('A', off(260, 40), 'Pharmacie des Couëts'), shelter('B', off(-240, 180), 'École des Tilleuls'), shelter('C', off(60, -320), 'Mairie annexe')];
const spots: ParcelSpot[] = Array.from({ length: 14 }, (_, i) => { const at = off(4 + (i % 4) * 3, 5 + Math.floor(i / 4) * 3); return { id: `demo${i}`, cell: cellAt(at[0], at[1]).id, at }; });
const cells = new Map<string, CellContent>();
const cell = (id: string): CellContent => { let c = cells.get(id); if (!c) { c = { id, shelters: [], parcels: [], roads: 1 }; cells.set(id, c); } return c; };
for (const s of shelters) cell(s.cell).shelters.push(s);
for (const p of spots) cell(p.cell).parcels.push(p);

const palier = Math.max(0, Math.min(3, Number(q.get('palier') ?? (etape === 'rangement0' ? 0 : 2)) || 0));
const save: GameSave = { ...emptyGameSave(), level: 8, skillPoints: 2, score: 1240, deliveries: 12, skills: { sac: 2, ...(palier >= 1 ? { 'exo-bras': 1 } : {}), ...(palier >= 2 ? { 'exo-jambes': 1 } : {}), ...(palier >= 3 ? { 'exo-gyro': 1 } : {}) } };
const game = new Game({ store: new MemoryGameStore(save), easeNewcomers: false });
let view: GameView | null = null;

const toast = document.createElement('p');
toast.style.cssText = 'position:absolute;left:12px;right:12px;top:8px;z-index:40;margin:0;padding:8px 12px;border-radius:12px;background:var(--panel-solid);border:1px solid var(--line-strong);font-size:13px;font-weight:600;text-align:center;pointer-events:none';
toast.hidden = true;
root.append(toast);
let toastT = 0;
const say = (text: string): void => { toast.textContent = text; toast.hidden = false; clearTimeout(toastT); toastT = window.setTimeout(() => { toast.hidden = true; }, 2800); };

const flow = new PickupFlow(root, {
  actions: game, view: () => view, toast: text => say(text), ui: () => { /* pas de son dans la démo */ },
  buzz: p => { try { navigator.vibrate?.(p); } catch { /* sans vibreur */ } },
  quick: () => q.get('rapide') === '1',
});
game.on(e => {
  if (flow.handle(e)) return;
  if (e.type === 'toast') say(e.text);
  else if (e.type === 'pickup') say(`${e.order.name} accroché`);
  else if (e.type === 'fumble') say(e.points ? `Sanglage manqué : −${e.points} points, le colis reste au sol` : 'Sanglage manqué : le colis reste au sol');
});

const fake = (): SeqParcel => {
  const kind = q.get('colis') ?? 'bois', special = (['cryo', 'ruche', 'batterie', 'boitenoire'] as SpecialKind[]).find(k => k === kind) ?? null;
  const crate: CrateKind = special ? SPECIALS[special].crate : (['bois', 'alu', 'plastique', 'carton'] as CrateKind[]).find(k => k === kind) ?? 'bois';
  const names: Record<string, string> = { bois: 'Outils', alu: 'Pièces de pompe', plastique: 'Médicaments', carton: 'Semences' };
  const labels: Record<string, string> = { bois: 'Caisse en bois', alu: 'Caisse en aluminium', plastique: 'Bac plastique', carton: 'Carton' };
  return {
    id: `démo-${kind}`, name: special ? SPECIALS[special].label : names[crate], crate, weightKg: Number(q.get('kg') ?? (special === 'batterie' ? 16 : 7)) || 7,
    fragile: q.get('fragile') === '1' || special === 'cryo', special, crateLabel: special ? 'Colis spécial' : labels[crate], timed: q.get('delai') === '1',
    inspected: false, known: '', labelHidden: q.get('etiquette') === '1', bearingDeg: null, destName: 'Pharmacie des Couëts',
  };
};

async function main(): Promise<void> {
  await game.load();
  game.setWorld([...cells.values()]);
  game.setWeather({ kind: q.get('pluie') === '1' ? 'pluie' : 'nuages', windKmh: 12, tempC: 13, night: q.get('nuit') === '1', sunAltDeg: 30 });
  game.setPosition({ lng: BASE[0], lat: BASE[1], acc: 5, source: 'simulé' });
  game.scan();
  const tick = (): void => { game.tick(0.2); view = game.view(); flow.render(view); };
  tick();
  setInterval(tick, 200);

  const frozen = etape !== '' && q.get('anime') !== '1';
  flow.seqOptions = {
    pano: (q.get('pano') as PanoName | null) ?? (frozen ? 'ville' : undefined), light: q.get('leger') === '1', flat: q.get('sans3d') === '1',
    freezeMs: frozen ? Number(q.get('fige') ?? 2600) || 2600 : undefined,
    demo: frozen ? {
      aim: q.get('vise') === '1', reached: etape === 'sanglage' ? Number(q.get('boucles') ?? 2) || 0 : undefined, ratchet: etape === 'cliquet',
      defects: q.has('defauts') ? Number(q.get('defauts')) : etape === 'inspection' ? 1 : undefined, label: q.get('etiquette') === '1', listen: q.get('ecoute') === '1',
    } : undefined,
  };

  if (etape.startsWith('rangement')) {
    // Sac déjà chargé : quelques colis ramassés par le vrai moteur, rangés d'office ou de travers.
    const all = view!.orders.filter(o => o.state === 'révélé').sort((a, b) => a.weightKg - b.weightKg);
    let n = 0;
    for (const o of all) { if (n >= (etape === 'rangement0' ? 2 : 4)) break; if (game.pickup(o.id).ok) n++; }
    if (etape === 'rangement2') { for (const o of game.view().orders.filter(x => x.state === 'porté')) game.stow(o.id, o.weightKg <= 9 && palier >= 2 ? 'jambeD' : palier >= 1 ? 'brasD' : 'dos'); }
    tick();
    const carried = view!.orders.filter(o => o.state === 'porté');
    flow.load.open(view, q.get('choix') === '0' ? null : carried[carried.length - 1]?.id ?? null);
    return;
  }
  const phase: Phase = etape === 'inspection' ? 'inspection' : etape === 'sanglage' || etape === 'cliquet' ? 'sanglage' : 'reperage';
  if (etape === '' && !q.has('colis')) {
    // Séquence complète, jouable : un bouton par colis repéré, puis le vrai ramassage et le rangement.
    const list = document.createElement('div');
    list.style.cssText = 'position:absolute;inset:60px 16px auto 16px;display:grid;gap:10px;pointer-events:auto';
    const draw = (): void => {
      list.replaceChildren(...game.view().orders.filter(o => o.state === 'révélé').slice(0, 6).map(o => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'dr-btn dr-btn-wide dr-btn-take';
        b.textContent = `Ramasser · ${o.name} (${o.weightKg} kg${o.fragile ? ', fragile' : ''})`;
        b.addEventListener('click', () => { flow.seqOptions = { ...flow.seqOptions, start: 'reperage' }; flow.start(o.id); });
        return b;
      }));
      const bag = document.createElement('button');
      bag.type = 'button'; bag.className = 'dr-btn dr-btn-wide'; bag.textContent = 'Sac';
      bag.addEventListener('click', () => flow.openBag());
      list.append(bag);
    };
    draw(); setInterval(draw, 1000);
    root.append(list);
    return;
  }
  // Étape figée sur un colis de démonstration.
  const p = fake();
  void flow.seq.run(p, {
    listen: () => p.special ? { text: `${SPECIALS[p.special].label}. ${SPECIALS[p.special].rule}`, tone: 'gold' }
      : q.get('surprise') === 'chat' ? { text: 'Un miaulement ! Un chat clandestin s’est glissé dedans. Il viendra avec toi.', tone: 'gold', cat: true }
      : p.fragile ? { text: 'Ça tinte : colis fragile, aucun geste brusque', tone: '' } : { text: 'Rien d’anormal, le contenu est bien calé', tone: '' },
    foundLabel: () => { /* démo */ }, ui: () => { /* démo */ }, buzz: () => { /* démo */ },
    conditions: () => ({ wet: q.get('pluie') === '1', night: q.get('nuit') === '1', tired: q.get('fatigue') === '1', exhausted: false }),
  }, { ...flow.seqOptions, start: phase }).then(r => say(`Fin de la séquence : ${JSON.stringify(r)}`));
}
void main();
Object.assign(window, { __pk: { game, flow, seqParcel } });
