// Note d'une livraison, de E à S.
import type { Grade, WeatherKind } from './api';
import { GRADE_BONUS, GRADE_MIN, GRADE_MULT } from './rules';

export interface GradeInput {
  /** État du colis, 0 à 1. */
  condition: number;
  /** Délai en minutes, null si la commande n'en a pas. */
  deadlineMin: number | null;
  /** Minutes écoulées depuis le ramassage. */
  elapsedMin: number;
  weather: WeatherKind;
  night: boolean;
}
export interface GradeOutput { grade: Grade; score: number; onTime: boolean; mult: number; notes: string[] }

const WET: Partial<Record<WeatherKind, string>> = { pluie: 'Sous la pluie', orage: 'Sous l’orage', neige: 'Sous la neige' };
export const isWet = (k: WeatherKind): boolean => k in WET;

export function gradeFromScore(score: number): Grade {
  for (const [g, min] of GRADE_MIN) if (score >= min) return g;
  return 'E';
}

export function gradeDelivery(i: GradeInput): GradeOutput {
  const condition = Math.min(1, Math.max(0, i.condition));
  const notes = [`État ${Math.round(condition * 100)} %`];
  let score = condition * 100, onTime = true;
  if (i.deadlineMin !== null) {
    const late = i.elapsedMin - i.deadlineMin;
    if (late <= 0) { score += GRADE_BONUS.onTime; notes.push('Dans les temps'); }
    else {
      onTime = false;
      score -= GRADE_BONUS.lateBase + Math.min(GRADE_BONUS.lateMaxExtra, late);
      notes.push(`En retard de ${Math.max(1, Math.round(late))} min`);
    }
  }
  const wet = WET[i.weather];
  if (wet) { score += GRADE_BONUS.wet; notes.push(wet); }
  if (i.night) { score += GRADE_BONUS.night; notes.push('De nuit'); }
  const grade = gradeFromScore(score);
  return { grade, score, onTime, mult: GRADE_MULT[grade], notes };
}
