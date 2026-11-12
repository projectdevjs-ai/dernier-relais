// Capteurs du téléphone pour la séquence de ramassage : cap (boussole), inclinaison, secousses.
// Tout est facultatif : sans capteur, `live` reste faux et le joueur vise en glissant le doigt.

interface OrientationEventIOS extends DeviceOrientationEvent { webkitCompassHeading?: number }
type PermissionFn = () => Promise<string>;
const angDiff = (a: number, b: number): number => ((a - b + 540) % 360) - 180;

export class Sensors {
  /** Cap lissé, en degrés (0 = nord si `absolute`, sinon repère arbitraire). */
  heading: number | null = null;
  /** Vrai si le cap est un vrai cap de boussole. */
  absolute = false;
  /** Inclinaison avant-arrière (bêta), lissée : 90 = téléphone droit devant soi. */
  tilt: number | null = null;
  /** Force des secousses (accélération hors gravité), en m/s². */
  motion = 0;
  private headingT = 0;
  private on = false;

  private ori = (h: number, beta: number | null, absolute: boolean): void => {
    if (!Number.isFinite(h)) return;
    if (absolute) this.absolute = true; else if (this.absolute) return; // la boussole prime sur le repère relatif
    this.headingT = performance.now();
    this.heading = this.heading === null ? h : (this.heading + angDiff(h, this.heading) * 0.2 + 360) % 360;
    if (beta !== null && Number.isFinite(beta)) this.tilt = this.tilt === null ? beta : this.tilt + (beta - this.tilt) * 0.2;
  };
  private screenAngle = (): number => (typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0);
  private onAbs = (e: Event): void => { const o = e as DeviceOrientationEvent; if (o.alpha !== null) this.ori((360 - o.alpha + this.screenAngle()) % 360, o.beta, true); };
  private onRel = (e: Event): void => {
    const o = e as OrientationEventIOS;
    if (typeof o.webkitCompassHeading === 'number') this.ori(o.webkitCompassHeading, o.beta, true);
    else if (o.alpha !== null) this.ori((360 - o.alpha + this.screenAngle()) % 360, o.beta, o.absolute === true);
  };
  private onMotion = (e: Event): void => {
    const a = (e as DeviceMotionEvent).acceleration;
    if (a && a.x !== null && a.y !== null && a.z !== null) this.motion = Math.hypot(a.x, a.y, a.z);
  };

  /** À appeler pendant un toucher du joueur : sur iOS, la permission des capteurs ne se demande qu'à ce moment-là. */
  start(): void {
    if (this.on || typeof window === 'undefined') return;
    this.on = true;
    const listen = (): void => {
      if (!this.on) return;
      window.addEventListener('deviceorientationabsolute', this.onAbs);
      window.addEventListener('deviceorientation', this.onRel);
      window.addEventListener('devicemotion', this.onMotion);
    };
    const ask = (ctor: unknown): Promise<unknown> => {
      const fn = (ctor as { requestPermission?: PermissionFn } | undefined)?.requestPermission;
      if (typeof fn !== 'function') return Promise.resolve('granted');
      try { return fn.call(ctor).catch(() => 'denied'); } catch { return Promise.resolve('denied'); }
    };
    const O = (window as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent, M = (window as { DeviceMotionEvent?: unknown }).DeviceMotionEvent;
    // Permission refusée : les événements ne viendront simplement pas, la visée au doigt prend le relais.
    void Promise.all([ask(O), ask(M)]).then(listen, listen);
  }
  stop(): void {
    this.on = false;
    if (typeof window === 'undefined') return;
    window.removeEventListener('deviceorientationabsolute', this.onAbs);
    window.removeEventListener('deviceorientation', this.onRel);
    window.removeEventListener('devicemotion', this.onMotion);
    this.heading = this.tilt = null; this.motion = 0; this.absolute = false;
  }
  /** Vrai si le cap est frais : le joueur vise en tournant sur lui-même. */
  get live(): boolean { return this.heading !== null && performance.now() - this.headingT < 1500; }
}
export { angDiff };
