import { describe, expect, it } from 'vitest';
import { cellAt, cellsAround } from '../src/core/geo';
import { dangerInCell } from '../src/game/dangers';
import { cleanRebirth, combat, craft, freshRebirth, spawnEncounter, canCraft, RECIPES } from '../src/game/rebirth';
import { dayKey } from '../src/game/time';
import { BASE, T0, place, rig, world } from './game.helpers';

describe('PROJECT REBIRTH — tactique déterministe', () => {
  it('génère la même menace à partir du même lieu et conserve les statistiques', () => {
    expect(spawnEncounter('zone-1')).toEqual(spawnEncounter('zone-1'));
    const state = freshRebirth();
    state.encounter = spawnEncounter('zone-1');
    expect(cleanRebirth(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it('fait payer les ressources et bloque la fabrication sans matériaux', () => {
    const start = freshRebirth();
    expect(canCraft(start, 'ration')).toBe(true);
    const next = craft(start, 'ration')!;
    expect(next.resources.scrap).toBe(start.resources.scrap-RECIPES.ration.cost.scrap!);
    expect(next.resources.rations).toBe(start.resources.rations+1);
    expect(start.resources.scrap).toBe(3);
    expect(craft(next, 'medkit')).toBeNull();
    expect(craft(start, 'repair')).toBeNull();
  });
  it('les tours déterministes déclenchent des ripostes et les défaites ne détruisent pas la sauvegarde', () => {
    const s = freshRebirth(); s.encounter=spawnEncounter('combat-d');
    const first = combat(s,'guard');
    expect(first.outcome).toBe('continue');
    expect(first.state.integrity).toBeLessThan(100);
    expect(s.integrity).toBe(100);
    expect(first.state.encounter?.turn).toBe(1);
    const second = combat(first.state,'strike');
    expect(second.state.encounter?.hp).toBeLessThan(first.state.encounter!.hp);
  });
  it('le combat se termine et attribue du butin une seule fois', () => {
    let s = freshRebirth();
    s.resources.charges = 9;
    s.encounter = spawnEncounter('combat-emp');
    let result = combat(s,'pulse');
    for(let i=0;i<12 && result.outcome==='continue';i++) result=combat(result.state,'pulse');
    expect(['victory','defeat']).toContain(result.outcome);
    if(result.outcome==='victory'){
      expect(result.state.victories).toBe(1);
      expect(result.state.encounter).toBeNull();
      expect(result.state.resources.scrap).toBeGreaterThan(3);
      expect(combat(result.state,'strike').outcome).toBe('invalid');
    }
  });
});

describe('PROJECT REBIRTH — intégration GPS',()=>{
  it('enregistre fabrication et bataille tactique dans les sauvegardes existantes', async ()=>{
    const r = await rig();
    expect(r.game.craftItem('ration')).toEqual({ok:true});
    expect(r.game.view().player.rebirth?.resources.rations).toBe(3);
    const cell = cellsAround(cellAt(BASE[0],BASE[1]),4).map(c=>c.id)
      .find(id=>dangerInCell(id, dayKey(T0),[])!==null)!;
    const danger = dangerInCell(cell,dayKey(T0),[])!;
    r.game.setWorld(world([],[],[cell]));
    place(r,danger.at);
    expect(r.game.engageThreat(danger.id)).toEqual({ok:true});
    expect(r.game.view().player.rebirth?.encounter?.id).toBe(danger.id);
    expect(r.game.combatMove('guard')).toEqual({ok:true});
    await r.game.flush();
    const other=await rig({store:r.store,t:r.clock.t});
    expect(other.game.view().player.rebirth?.encounter?.turn).toBe(1);
    expect(other.game.view().player.rebirth?.resources.rations).toBe(3);
  });
});
