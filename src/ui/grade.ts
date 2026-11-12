// Écran de note après une livraison : le moment fort. Une grande lettre frappée comme un tampon,
// puis le détail, les gains et les étoiles de l'abri. Plusieurs livraisons s'enchaînent.
import type { ActionResult, DeliveryResult, Grade } from '../game/api';
import { btn, fmtInt, h, reducedMotion } from './dom';
import { icon } from './icons';
import { ProofCamera, cameraAvailable } from './proof';
import { NPC, starRow } from './shelter';

const WORD: Record<Grade, string> = { S: 'Parfait', A: 'Excellent', B: 'Solide', C: 'Correct', D: 'Passable', E: 'Limite' };

/** Compte de 0 à `to` en un peu moins d'une seconde. */
function countUp(el: HTMLElement, to: number, prefix: string, suffix: string, delayMs: number): void {
  const final = `${prefix}${fmtInt(to)}${suffix}`;
  if (reducedMotion()) { el.textContent = final; return; }
  el.textContent = `${prefix}0${suffix}`;
  const dur = 700;
  let t0 = 0;
  const step = (t: number): void => {
    if (!el.isConnected) return;
    if (!t0) t0 = t + delayMs;
    const k = Math.max(0, Math.min(1, (t - t0) / dur));
    el.textContent = k >= 1 ? final : `${prefix}${fmtInt(to * (1 - (1 - k) ** 3))}${suffix}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export class GradeScreen {
  readonly el: HTMLElement;
  private queue: DeliveryResult[] = [];
  private total = 0;
  private done = 0;
  private lastFocus: Element | null = null;
  /** Appelé à chaque nouvelle note affichée (pour fermer les panneaux dessous). */
  onShow: (() => void) | null = null;
  // Photo-preuve de la note affichée : la photo ne vit que dans cet écran, elle disparaît avec lui.
  private camera = new ProofCamera();
  private current: DeliveryResult | null = null;
  private proofSlot: HTMLElement | null = null;
  /** Faux dès que la caméra a été refusée ou s'est révélée absente : on ne repropose plus. */
  private cameraOk = true;

  /** `proof` : déclare au jeu qu'une photo-preuve a été prise (sans lui, la photo n'est pas proposée). */
  constructor(parent: HTMLElement, private proof?: (orderId: string) => ActionResult) {
    this.el = h('div', 'dr-grade');
    this.el.hidden = true;
    this.el.tabIndex = -1;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Note de livraison');
    parent.append(this.el);
  }

  get busy(): boolean { return !this.el.hidden; }

  push(r: DeliveryResult): void {
    this.queue.push(r);
    this.total++;
    if (this.el.hidden) { this.lastFocus = document.activeElement; this.next(); }
    else this.el.querySelector('.dr-grade-count')?.replaceChildren(`${this.done} / ${this.total}`);
  }

  private next(): void {
    this.camera.close();
    this.current = null; this.proofSlot = null;
    const r = this.queue.shift();
    if (!r) {
      this.el.hidden = true; this.total = 0; this.done = 0;
      this.el.replaceChildren();
      if (this.lastFocus instanceof HTMLElement && this.lastFocus.isConnected) this.lastFocus.focus({ preventScroll: true });
      return;
    }
    this.done++;
    this.onShow?.();
    this.show(r);
  }

  private show(r: DeliveryResult): void {
    const count = h('span', 'dr-grade-count', this.total > 1 ? `${this.done} / ${this.total}` : '');
    const top = h('div', 'dr-grade-top',
      h('div', 'dr-grade-kick', h('span', '', r.special ? 'Colis spécial livré' : r.lostBy ? 'Colis retrouvé et livré' : 'Colis livré'), count),
      h('h2', 'dr-grade-order', r.orderName),
      h('p', 'dr-grade-dest', icon('pin'), h('span', '', r.shelterName)));

    // Le sceau : couronne graduée, anneau qui se trace, lettre qui tombe.
    const seal = h('div', 'dr-seal');
    seal.innerHTML = '<svg viewBox="0 0 200 200" aria-hidden="true"><circle class="dr-seal-ticks" cx="100" cy="100" r="94"/><circle class="dr-seal-track" cx="100" cy="100" r="82"/><circle class="dr-seal-ring" cx="100" cy="100" r="82" pathLength="100" transform="rotate(-90 100 100)"/></svg>';
    seal.append(h('span', 'dr-seal-letter', r.grade), h('span', 'dr-seal-flash'));
    const word = h('p', 'dr-grade-word', WORD[r.grade]);
    word.setAttribute('aria-label', `Note ${r.grade}, ${WORD[r.grade]}`);

    const notes = h('ul', 'dr-grade-notes');
    r.notes.forEach((n, i) => { const li = h('li', '', n); li.style.setProperty('--i', String(i)); notes.append(li); });

    const pts = h('span', 'dr-gain-val'), xp = h('span', 'dr-gain-val');
    countUp(pts, r.points, '+', '', 900);
    countUp(xp, r.xp, '+', '', 1000);
    const gains = h('div', 'dr-gains', h('div', 'dr-gain', pts, h('span', 'dr-gain-unit', 'points')), h('div', 'dr-gain', xp, h('span', 'dr-gain-unit', 'XP')));

    // Étoiles de l'abri : état d'avant, puis l'étoile gagnée s'allume.
    const stars = starRow('dr-stars-xl');
    stars.set(r.starsBefore);
    const gained = r.starsAfter > r.starsBefore;
    stars.stars.forEach((s, i) => {
      if (i >= r.starsBefore && i < r.starsAfter) { s.classList.add('is-gain'); s.style.setProperty('--i', String(i - r.starsBefore)); }
    });
    stars.el.setAttribute('aria-label', `${r.starsAfter} étoile${r.starsAfter > 1 ? 's' : ''} sur 5`);
    const npcName = r.starsAfter > 0 ? NPC[r.npc].name : 'L’abri';
    const shel = h('div', `dr-grade-shel${gained ? ' is-gain' : ''}`,
      stars.el,
      gained ? h('p', 'dr-grade-star', r.starsBefore === 0 ? `${npcName} te fait confiance` : 'Nouvelle étoile') : null,
      r.unlock ? h('p', 'dr-grade-unlock', icon('lock'), h('span', '', r.unlock)) : null);

    const level = r.levelUp ? h('p', 'dr-grade-level', icon('xp'), h('span', '', 'Niveau supérieur')) : null;
    const go = btn('dr-btn dr-btn-wide dr-grade-go', null, this.queue.length ? 'Suivant' : 'Continuer');
    go.addEventListener('click', () => this.next());

    // Photo-preuve : proposée seulement si l'appareil a une caméra ; un refus la fait disparaître sans rien dire.
    const proofSlot = h('div', 'dr-proof');
    proofSlot.hidden = true;
    this.current = r; this.proofSlot = proofSlot;
    const bonus = r.proofBonus ?? 0;
    if (this.proof && this.cameraOk && bonus > 0) {
      void cameraAvailable().then((ok) => {
        if (!ok) { this.cameraOk = false; return; }
        if (this.current !== r) return;
        const shoot = btn('dr-btn dr-btn-line dr-proof-btn', null, icon('camera'), h('span', '', 'Photo-preuve'), h('span', 'dr-cost', `+${fmtInt(bonus)} pts`));
        shoot.addEventListener('click', () => { void this.shoot(r, shoot); });
        proofSlot.replaceChildren(shoot);
        proofSlot.hidden = false;
      });
    }

    this.el.dataset.grade = r.grade;
    this.el.hidden = false;
    this.el.replaceChildren(top, h('div', 'dr-grade-mid', seal, word, notes), h('div', 'dr-grade-low', gains, shel, level, proofSlot), go);
    this.el.focus({ preventScroll: true });
  }

  private async shoot(r: DeliveryResult, shootBtn: HTMLButtonElement): Promise<void> {
    const slot = this.proofSlot;
    shootBtn.disabled = true;
    let photo: string | null = null;
    try { photo = await this.camera.open(this.el); }
    catch { this.cameraOk = false; if (this.current === r && slot) slot.hidden = true; return; } // refusée ou absente : l'option disparaît
    if (this.current !== r || !slot) return;
    if (!photo) { shootBtn.disabled = false; return; } // viseur fermé sans photo
    if (!this.proof || !this.proof(r.orderId).ok) { slot.hidden = true; return; } // trop tard : pas de bonus, pas de photo
    const img = h('img', 'dr-proof-photo');
    img.src = photo; img.alt = `Photo-preuve de la livraison à ${r.shelterName}`;
    slot.replaceChildren(img, h('span', 'dr-proof-txt', icon('check'), h('span', 'dr-proof-pts', `Photo-preuve : +${fmtInt(r.proofBonus ?? 0)} pts`)));
    slot.classList.add('is-done');
  }

  /** Le jeu confirme le bonus de photo. Renvoie vrai si cet écran l'affiche déjà (sinon le HUD fait un toast). */
  proofDone(orderId: string, _points: number): boolean {
    return this.current !== null && this.current.orderId === orderId && !this.el.hidden;
  }
}
