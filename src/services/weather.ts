// Météo réelle (Open-Meteo, gratuit et sans clé) et hauteur du soleil. Seul fichier du jeu qui utilise le réseau.
import type { Weather, WeatherKind } from '../game/api';

const RAD = Math.PI / 180;
/** En dessous de cette hauteur, le soleil est couché (bord du disque et réfraction compris). */
const SUNSET_ALT = -0.83;

/** Hauteur du soleil au-dessus de l'horizon, en degrés (négative la nuit). Précision d'environ 1°. */
export function sunAltitudeDeg(date: Date, lng: number, lat: number): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (date.getTime() - start) / 86400000; // 0 = 1er janvier à minuit
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = (2 * Math.PI / 365) * (dayOfYear - hours / 24 + (hours - 12) / 24); // angle de l'année
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  // Équation du temps, en minutes.
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const solarMin = hours * 60 + eot + 4 * lng;
  const hourAngle = (solarMin / 4 - 180) * RAD;
  const sinAlt = Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(hourAngle);
  return Math.asin(Math.min(1, Math.max(-1, sinAlt))) / RAD;
}
export const isNight = (sunAltDeg: number): boolean => sunAltDeg < SUNSET_ALT;

/** Code météo international (WMO) -> temps du jeu. */
export function kindFromCode(code: number): WeatherKind {
  if (code === 0 || code === 1) return 'clair';
  if (code === 2 || code === 3) return 'nuages';
  if (code === 45 || code === 48) return 'brouillard';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'neige';
  if (code >= 95) return 'orage';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'pluie';
  return 'nuages';
}

/** Temps de repli quand la météo est injoignable : ciel clair, nuit calculée par le soleil. */
export function clearWeather(lng: number, lat: number, date: Date = new Date()): Weather {
  const sunAltDeg = sunAltitudeDeg(date, lng, lat);
  return { kind: 'clair', windKmh: 0, tempC: 15, night: isNight(sunAltDeg), sunAltDeg };
}

export interface WeatherOptions { fetch?: typeof fetch; now?: Date; timeoutMs?: number }

/** Météo actuelle à cet endroit. Ne lève jamais d'erreur. */
export async function fetchWeather(lng: number, lat: number, opts: WeatherOptions = {}): Promise<Weather> {
  const date = opts.now ?? new Date();
  const fallback = clearWeather(lng, lat, date);
  const doFetch = opts.fetch ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return fallback;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? 8000) : null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,weather_code,wind_speed_10m,is_day`;
    const res = await doFetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) return fallback;
    const cur = ((await res.json()) as { current?: Record<string, unknown> } | null)?.current;
    if (!cur || typeof cur.weather_code !== 'number') return fallback;
    const n = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    return {
      kind: kindFromCode(cur.weather_code),
      windKmh: Math.max(0, n(cur.wind_speed_10m, 0)),
      tempC: n(cur.temperature_2m, fallback.tempC),
      night: cur.is_day === 0 || cur.is_day === 1 ? cur.is_day === 0 : fallback.night,
      sunAltDeg: fallback.sunAltDeg,
    };
  } catch {
    return fallback;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
