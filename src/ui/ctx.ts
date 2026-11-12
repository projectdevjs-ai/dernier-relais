// Ce que le HUD prête à ses modules : les actions du jeu et quelques services communs.
import type { ActionResult, HudEvents, UiKind } from '../game/api';

export type Tone = 'info' | 'good' | 'warn';

export interface Ctx {
  events: HudEvents;
  toast(text: string, tone?: Tone): void;
  /** Affiche le motif si l'action est refusée. Renvoie vrai si elle a réussi. */
  run(r: ActionResult): boolean;
  openOrder(id: string): void;
  openShelter(id: string): void;
  /** Son d'interface (sans effet si l'appelant n'en fournit pas). */
  ui(kind: UiKind): void;
}
