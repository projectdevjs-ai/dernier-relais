import { describe, expect, it } from 'vitest';
import { cellAt, cellsAround } from '../src/core/geo';
import { dangerInCell } from '../src/game/dangers';
import { dayKey } from '../src/game/time';
import { BASE, T0, findSpot, off, place, rig, shelter, walk, world } from './game.helpers';

const A = shelter('A', off(0, 0), 'Relais A');
const B = shelter('B', off(350, 0), 'Relais B');

describe('refonte des relais', () => {
  it('dépose un colis à un mauvais relais pour de la réputation uniquement, sans duplication', async () => {
    const spot = findSpot('h', off(15, 0), [A, B], o => o.destId === 'B' && !o.fragile && o.weightKg < 5);
    const r = await rig();
    r.game.setWorld(world([A, B], [spot]));
    place(r, spot.at);
    expect(r.game.scan().ok).toBe(true);
    expect(r.game.pickup(spot.id)).toEqual({ ok: true });
    const before = r.game.view().player;
    expect(r.game.handoff(spot.id, 'A')).toEqual({ ok: true });
    const after = r.game.view().player;
    expect(after.reputation).toBe((before.reputation ?? 0) + 10);
    expect(after.score).toBe(before.score);
    expect(after.xp).toBe(before.xp);
    expect(after.deliveries).toBe(before.deliveries);
    expect(r.game.handoff(spot.id, 'A').ok).toBe(false);
    expect(r.game.view().orders.find(o => o.id === spot.id)).toBeUndefined();
    await r.game.flush();
    const reloaded = await rig({ store: r.store, t: r.clock.t });
    expect(reloaded.game.view().player.reputation).toBe(10);
  });

  it('propose toujours une mission dans chaque relais et en génère une nouvelle après récompense', async () => {
    const r = await rig();
    r.game.setWorld(world([A, B], []));
    place(r, A.at);
    const first = r.game.view().shelters.find(s => s.id === 'A')!.mission!;
    expect(first.active).toBe(false);
    expect(first.label).toContain('250 m');
    expect(r.game.relayMission('A')).toEqual({ ok: true });
    walk(r, off(275, 0));
    const done = r.game.view().shelters.find(s => s.id === 'A')!.mission!;
    expect(done.done).toBe(true);
    place(r, A.at);
    const score = r.game.view().player.score;
    expect(r.game.relayMission('A')).toEqual({ ok: true });
    const next = r.game.view().shelters.find(s => s.id === 'A')!.mission!;
    expect(next.label).not.toBe(first.label);
    expect(next.active).toBe(false);
    expect(r.game.view().player.score).toBe(score + first.reward);
  });
});

describe('rencontres tactiques GPS', () => {
  it('résout une menace à l’arrêt une seule fois par jour', async () => {
    const cell = cellsAround(cellAt(BASE[0], BASE[1]), 4).map(x => x.id)
      .find(id => dangerInCell(id, dayKey(T0), []) !== null)!;
    const zone = dangerInCell(cell, dayKey(T0), [])!;
    const r = await rig();
    r.game.setWorld(world([], [], [cell]));
    place(r, zone.at);
    const threat = r.game.view().dangers.find(x => x.id === zone.id)!;
    expect(threat.inside).toBe(true);
    expect(threat.enemy).toBeTruthy();
    expect(r.game.resolveThreat(zone.id, 'eviter')).toEqual({ ok: true });
    expect(r.game.resolveThreat(zone.id, 'eviter').ok).toBe(false);
    expect(r.game.view().dangers.find(x => x.id === zone.id)?.resolved).toBe(true);
  });
});
