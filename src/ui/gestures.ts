// Gestes tactiles de l'interface : tirer (fiche du bas, panneaux), glisser (onglets), appui long.
// Au doigt : événements « touch » (on peut laisser défiler une liste ou prendre la main selon le geste).
// À la souris : événements « pointer », pour que les mêmes gestes marchent sur ordinateur.

export interface DragStart { target: Element; dx: number; dy: number }
export interface DragOpts {
  axis: 'x' | 'y';
  /** Appelé une fois, quand le doigt a bougé de quelques pixels dans le bon axe : vrai pour prendre la main. */
  canStart(s: DragStart): boolean;
  /** Déplacement depuis le début du geste (px, signé). */
  move(d: number): void;
  /** Fin du geste : déplacement final et vitesse (px/ms, signée). `cancelled` : geste interrompu par le système. */
  end(d: number, v: number, cancelled: boolean): void;
}

const SLOP = 8;

/** Rend `el` déplaçable dans un axe. Ne gêne ni les touchers simples ni le défilement dans l'autre axe. */
export function drag(el: HTMLElement, o: DragOpts): void {
  let x0 = 0, y0 = 0, state: 'idle' | 'wait' | 'on' | 'off' = 'idle';
  let d = 0, lastD = 0, lastT = 0, v = 0, target: Element = el;

  const begin = (x: number, y: number, t: EventTarget | null): void => { x0 = x; y0 = y; d = 0; v = 0; state = 'wait'; target = t instanceof Element ? t : el; };
  /** Renvoie vrai si le geste est pris en main (l'appelant bloque alors le défilement natif). */
  const track = (x: number, y: number): boolean => {
    if (state === 'idle' || state === 'off') return false;
    const dx = x - x0, dy = y - y0;
    if (state === 'wait') {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return false;
      const along = o.axis === 'y' ? Math.abs(dy) > Math.abs(dx) * 1.2 : Math.abs(dx) > Math.abs(dy) * 1.6;
      if (!along || !o.canStart({ target, dx, dy })) { state = 'off'; return false; }
      state = 'on';
      // Le geste part de là où le doigt se trouve : pas de saut de quelques pixels.
      x0 = x; y0 = y; lastD = 0; lastT = performance.now();
      return true;
    }
    d = o.axis === 'y' ? y - y0 : x - x0;
    const now = performance.now(), dt = now - lastT;
    if (dt > 12) { v = v * 0.4 + ((d - lastD) / dt) * 0.6; lastD = d; lastT = now; }
    o.move(d);
    return true;
  };
  const finish = (cancelled: boolean): void => {
    const was = state;
    state = 'idle';
    if (was !== 'on') return;
    // Doigt arrêté avant d'être levé : pas d'élan.
    if (performance.now() - lastT > 90) v = 0;
    o.end(d, v, cancelled);
  };

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { finish(true); return; }
    const t = e.touches[0]!;
    begin(t.clientX, t.clientY, e.target);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (!t) return;
    if (track(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchend', () => finish(false));
  el.addEventListener('touchcancel', () => finish(true));

  // Souris : même geste ; le clic qui suit un vrai déplacement est avalé.
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    begin(e.clientX, e.clientY, e.target);
    const mv = (m: PointerEvent): void => { track(m.clientX, m.clientY); };
    const up = (): void => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      if (state === 'on') {
        const eat = (c: Event): void => { c.stopPropagation(); c.preventDefault(); };
        addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => removeEventListener('click', eat, { capture: true }), 60);
      }
      finish(false);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
}

/** Appui long (sans bouger) : `fn` est appelée, et le clic qui suivrait est avalé. */
export function longPress(el: HTMLElement, fn: () => void, ms = 460): void {
  let timer: ReturnType<typeof setTimeout> | null = null, x = 0, y = 0, fired = false;
  const clear = (): void => { if (timer) { clearTimeout(timer); timer = null; } el.classList.remove('is-held'); };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    x = e.clientX; y = e.clientY; fired = false;
    clear();
    el.classList.add('is-held');
    timer = setTimeout(() => { timer = null; fired = true; el.classList.remove('is-held'); fn(); }, ms);
  });
  el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) clear(); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave'] as const) el.addEventListener(t, clear);
  el.addEventListener('click', (e) => { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } }, true);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** Résistance élastique au-delà d'une butée. */
export function rubber(d: number, limit = 90): number {
  const s = Math.sign(d), a = Math.abs(d);
  return s * limit * (1 - Math.exp(-a / (limit * 1.6)));
}

/** Fait défiler un nombre entier vers sa nouvelle valeur (texte écrit seulement quand il change). */
export function rollNumber(el: HTMLElement, to: number, fmt: (n: number) => string, ms = 600): void {
  const state = el as HTMLElement & { __roll?: { to: number; raf: number } };
  const cur = state.__roll;
  if (cur && cur.to === to) return;
  const final = fmt(to);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (cur) cancelAnimationFrame(cur.raf);
  const from = cur ? cur.to : null;
  if (from === null || reduce || !el.isConnected) { state.__roll = { to, raf: 0 }; if (from === null && !reduce && el.isConnected && to > 0) { /* première valeur : part de zéro */ } else { if (el.textContent !== final) el.textContent = final; return; } }
  const a = from ?? 0;
  let t0 = 0;
  const step = (t: number): void => {
    if (!t0) t0 = t;
    const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
    const s = k >= 1 ? final : fmt(Math.round(a + (to - a) * e));
    if (el.textContent !== s) el.textContent = s;
    if (k < 1 && el.isConnected) state.__roll = { to, raf: requestAnimationFrame(step) };
  };
  state.__roll = { to, raf: requestAnimationFrame(step) };
}
