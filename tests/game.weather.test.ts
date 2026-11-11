import { describe, expect, it } from 'vitest';
import { clearWeather, fetchWeather, isNight, kindFromCode, sunAltitudeDeg } from '../src/services/weather';

const PARIS: [number, number] = [2.35, 48.85];
const utc = (y: number, m: number, d: number, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));
const reply = (current: unknown, ok = true) => (async () => ({ ok, json: async () => ({ current }) })) as unknown as typeof fetch;

describe('soleil', () => {
  it('est au zénith à midi sur l’équateur à l’équinoxe', () => {
    expect(sunAltitudeDeg(utc(2026, 3, 20, 12, 7), 0, 0)).toBeGreaterThan(87);
  });
  it('donne les hauteurs connues à Paris aux solstices', () => {
    expect(sunAltitudeDeg(utc(2026, 6, 21, 11, 52), ...PARIS)).toBeCloseTo(64.6, 0);
    expect(sunAltitudeDeg(utc(2026, 12, 21, 11, 49), ...PARIS)).toBeCloseTo(17.7, 0);
  });
  it('passe sous l’horizon la nuit', () => {
    const midnight = sunAltitudeDeg(utc(2026, 6, 21, 23, 52), ...PARIS);
    expect(midnight).toBeLessThan(-15); expect(midnight).toBeGreaterThan(-20);
    expect(isNight(midnight)).toBe(true);
    expect(isNight(sunAltitudeDeg(utc(2026, 6, 21, 12), ...PARIS))).toBe(false);
    // Soir d'hiver à Paris : nuit à 18 h (heure universelle), jour à 15 h.
    expect(isNight(sunAltitudeDeg(utc(2026, 12, 21, 18), ...PARIS))).toBe(true);
    expect(isNight(sunAltitudeDeg(utc(2026, 12, 21, 14), ...PARIS))).toBe(false);
  });
  it('reste levé à minuit en été au-delà du cercle polaire', () => {
    expect(sunAltitudeDeg(utc(2026, 6, 21, 0), 0, 80)).toBeGreaterThan(5);
  });
  it('dépend de la longitude', () => {
    const d = utc(2026, 9, 1, 6);
    expect(sunAltitudeDeg(d, 60, 45)).toBeGreaterThan(sunAltitudeDeg(d, -60, 45));
  });
});

describe('météo', () => {
  it('traduit les codes météo', () => {
    const k = (codes: number[]) => [...new Set(codes.map(kindFromCode))];
    expect(k([0, 1])).toEqual(['clair']);
    expect(k([2, 3])).toEqual(['nuages']);
    expect(k([45, 48])).toEqual(['brouillard']);
    expect(k([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82])).toEqual(['pluie']);
    expect(k([71, 73, 75, 77, 85, 86])).toEqual(['neige']);
    expect(k([95, 96, 99])).toEqual(['orage']);
    expect(kindFromCode(1234 - 1200)).toBe('nuages');
  });
  it('interroge Open-Meteo et lit la réponse', async () => {
    let asked = '';
    const f = (async (url: string) => { asked = url; return { ok: true, json: async () => ({ current: { temperature_2m: 9.3, weather_code: 61, wind_speed_10m: 22.4, is_day: 1 } }) }; }) as unknown as typeof fetch;
    const w = await fetchWeather(-1.5761, 47.1822, { fetch: f, now: utc(2026, 11, 11, 23) });
    expect(asked).toBe('https://api.open-meteo.com/v1/forecast?latitude=47.1822&longitude=-1.5761&current=temperature_2m,weather_code,wind_speed_10m,is_day');
    expect(w.kind).toBe('pluie'); expect(w.windKmh).toBe(22.4); expect(w.tempC).toBe(9.3);
    expect(w.night).toBe(false); // l'indication jour/nuit du service passe avant le calcul
    expect(w.sunAltDeg).toBeLessThan(0);
    expect((await fetchWeather(...PARIS, { fetch: reply({ weather_code: 95, is_day: 0 }), now: utc(2026, 6, 21, 12) })))
      .toMatchObject({ kind: 'orage', night: true, windKmh: 0 });
  });
  it('renvoie un temps clair quand le réseau échoue, avec la nuit calculée par le soleil', async () => {
    const down = (async () => { throw new Error('hors ligne'); }) as unknown as typeof fetch;
    const night = await fetchWeather(...PARIS, { fetch: down, now: utc(2026, 12, 21, 22) });
    expect(night).toMatchObject({ kind: 'clair', night: true, windKmh: 0 });
    const day = await fetchWeather(...PARIS, { fetch: down, now: utc(2026, 6, 21, 12) });
    expect(day.kind).toBe('clair'); expect(day.night).toBe(false); expect(day.sunAltDeg).toBeGreaterThan(60);
    expect(day).toEqual(clearWeather(...PARIS, utc(2026, 6, 21, 12)));
  });
  it('renvoie un temps clair quand la réponse est inutilisable', async () => {
    const now = utc(2026, 6, 21, 12), clear = clearWeather(...PARIS, now);
    expect(await fetchWeather(...PARIS, { fetch: reply({ weather_code: 61 }, false), now })).toEqual(clear);
    expect(await fetchWeather(...PARIS, { fetch: reply(undefined), now })).toEqual(clear);
    expect(await fetchWeather(...PARIS, { fetch: reply({ weather_code: 'pluie' }), now })).toEqual(clear);
    const broken = (async () => ({ ok: true, json: async () => { throw new Error('illisible'); } })) as unknown as typeof fetch;
    expect(await fetchWeather(...PARIS, { fetch: broken, now })).toEqual(clear);
  });
});
