// PROJECT REBIRTH — console de survie et arène tactique mobile, sans ressources externes.
import './rebirth.css';
import { CinematicBattle } from './battle3d';
import type { GameActions, GameView, ActionResult } from '../game/api';
import { RECIPES, type CombatMove, type Recipe, type Resource, type Rebirth, type Faction } from '../game/rebirth';

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function button(label: string, className: string, fn: () => void): HTMLButtonElement {
  const b = el('button', className, label) as HTMLButtonElement;
  b.type = 'button'; b.addEventListener('click', fn); return b;
}
function bar(value: number, max: number, cls = ''): HTMLElement {
  const track = el('span', 'rb-track ' + cls);
  const fill = el('span', 'rb-fill');
  fill.style.width = Math.round(Math.max(0, Math.min(1, max ? value/max : 0)) * 100) + '%';
  track.append(fill); return track;
}
const RESOURCES: { key: Resource; icon: string; name: string }[] = [
  { key:'scrap', icon:'⬡', name:'Alliage' }, { key:'circuits', icon:'⌘', name:'Circuits' },
  { key:'rations', icon:'◈', name:'Rations' }, { key:'medkits', icon:'✚', name:'Soins' },
  { key:'charges', icon:'ϟ', name:'EMP' },
];
const FACTIONS: { key: Faction; label: string; sub: string }[] = [
  { key:'lumen', label:'STATION LUMEN', sub:'République des survivants' },
  { key:'nomades', label:'LES NOMADES', sub:'Récupérateurs et caravanes' },
  { key:'archives', label:'LES ARCHIVES', sub:'Réseaux autonomes oubliés' },
];
export class RebirthConsole {
  private readonly trigger = button('◈  SURVIE', 'rb-trigger', () => this.open());
  private readonly veil = el('div','rb-veil');
  private readonly panel = el('section','rb-panel');
  private readonly body = el('div','rb-body');
  private readonly status = el('span','rb-trigger-alert');
  private last = '';
  private battle: CinematicBattle | null = null;
  private opened = false;
  /** Ne montre pas à nouveau une confrontation que le joueur a volontairement réduite. */
  private announcedEncounter: string | null = null;
  private tab: 'survie' | 'fabrication' | 'factions' | 'radio' = 'survie';
  private view: GameView | null = null;
  constructor(root: HTMLElement, private actions: GameActions, private run: (r: ActionResult) => boolean,
    private overlay?: (open: boolean) => void) {
    this.trigger.setAttribute('aria-label','Ouvrir la console de survie');
    this.trigger.append(this.status);
    this.veil.hidden = true;
    this.veil.setAttribute('role','dialog');
    this.veil.setAttribute('aria-modal','true');
    this.veil.setAttribute('aria-label','PROJECT REBIRTH — console tactique');
    this.veil.addEventListener('click', e => { if (e.target === this.veil) this.close(); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && this.opened) this.close(); });
    this.panel.append(this.body);
    this.veil.append(this.panel);
    root.append(this.trigger, this.veil);
  }
  get isOpen(): boolean { return this.opened; }
  open(): void {
    if (this.opened) return;
    this.opened = true; this.veil.hidden = false; this.last = ''; this.overlay?.(true); this.draw();
  }
  close(): void { if (!this.opened) return; this.opened = false; this.veil.hidden = true; this.battle?.dispose(); this.battle = null; this.overlay?.(false); }
  render(v: GameView): void {
    this.view = v;
    const s = v.player.rebirth, threat = s?.encounter;
    this.status.textContent = threat ? ' !' : s?.radio ? ' ●' : '';
    this.trigger.classList.toggle('rb-radio-pending',!!s?.radio);
    this.trigger.classList.toggle('rb-in-combat', !!threat);
    // Une confrontation active mérite une ouverture immédiate, sans pop-up durant la marche.
    if (!threat) this.announcedEncounter = null;
    if (threat && this.announcedEncounter !== threat.id && !v.player.moving && !v.player.vehicle && document.body.classList.contains('dr-map-on')) {
      this.announcedEncounter = threat.id;
      this.open();
    }
    if (!this.opened) return;
    const key = JSON.stringify({ r:s, st:v.player.stamina, lvl:v.player.level, moving:v.player.moving,
      vehicle:v.player.vehicle, score:v.player.score, tab:this.tab });
    if (key === this.last) return;
    this.last = key; this.draw();
  }
  private act(r: ActionResult): void {
    if (this.run(r)) { this.last = ''; this.draw(); }
  }
  private draw(): void {
    const v = this.view, state = v?.player.rebirth;
    if (!v || !state) return;
    this.battle?.dispose(); this.battle = null;
    this.body.replaceChildren();
    const top = el('header','rb-head');
    const title = el('div','rb-head-title');
    title.append(el('span','rb-eyebrow','LUMEN NETWORK  /  OPERATOR SYSTEM'), el('h2','rb-title','PROJECT REBIRTH'));
    const close = button('✕','rb-close',() => this.close());
    close.setAttribute('aria-label','Fermer la console');
    top.append(title,close); this.body.append(top);
    const encounter = state.encounter;
    if (encounter) { this.drawBattle(v,state); return; }
    const summary = el('div','rb-status-card');
    const summaryText = el('div','rb-status-text');
    summaryText.append(el('span','rb-eyebrow','PORTEUR ACTIF  //  STATION LUMEN'),
      el('strong','rb-status-name','SYSTÈMES EN LIGNE'),
      el('span','rb-muted',`Niveau ${v.player.level}  ·  ${state.victories} menaces neutralisées`));
    const percentage = el('div','rb-integrity-n');
    percentage.append(el('span','',String(state.integrity)),el('small','',' / 100'));
    summary.append(summaryText, percentage, bar(state.integrity,100,'rb-integrity'));
    this.body.append(summary);
    const tabs = el('nav','rb-tabs');
    for (const [id,label] of [['survie','SAC'],['fabrication','ATELIER'],['factions','FACTIONS'],['radio','RADIO']] as const) {
      const b = button(label, 'rb-tab'+(this.tab===id?' is-active':''), ()=>{ this.tab=id; this.last=''; this.draw(); });
      tabs.append(b);
    }
    this.body.append(tabs);
    if (this.tab==='survie') this.drawInventory(v,state);
    else if(this.tab==='fabrication') this.drawCraft(state);
    else if(this.tab==='factions') this.drawFactions(state);
    else this.drawRadio(v,state);
    this.body.append(el('footer','rb-footer','DERNIER RELAIS · PROJECT REBIRTH / 0 € DE SERVEUR'));
  }
  private drawInventory(v: GameView,s: Rebirth): void {
    this.body.append(el('div','rb-section-label','01  /  ÉQUIPEMENT DE TERRAIN'));
    const grid = el('div','rb-resources');
    for(const item of RESOURCES) {
      const cell = el('div','rb-resource');
      cell.append(el('span','rb-resource-glyph',item.icon),el('span','rb-resource-value',String(s.resources[item.key])),
        el('span','rb-resource-name',item.name));
      grid.append(cell);
    }
    this.body.append(grid);
    this.body.append(el('div','rb-section-label','02  /  RÉCUPÉRATION'));
    const tools = el('div','rb-actions');
    const ration = button('CONSOMMER UNE RATION','rb-action',()=>this.act(this.actions.useSupply?.('rations') ?? {ok:false,why:'Indisponible'}));
    const heal = button('UTILISER UN SOIN','rb-action',()=>this.act(this.actions.useSupply?.('medkits') ?? {ok:false,why:'Indisponible'}));
    ration.disabled = s.resources.rations===0 || v.player.stamina>=0.99;
    heal.disabled = s.resources.medkits===0 || s.integrity>=100;
    tools.append(ration,heal); this.body.append(tools);
    const tip=el('p','rb-hint','Récupère des matériaux dans les caches et en livrant des colis. Fabrique des équipements dans l’atelier. Les combats ne se jouent qu’à l’arrêt.');
    this.body.append(tip);
    this.body.append(el('div','rb-section-label','03  /  OBJECTIFS'));
    const stats=el('div','rb-stats');
    for(const [label,value] of [
      ['RENCONTRES GAGNÉES',String(s.victories)],['RÉPUTATION',String(v.player.reputation??0)],
      ['LIVRAISONS',String(v.player.deliveries)],['ÉQUIPEMENT',s.integrity+' %']])
    { const line=el('div','rb-stat');line.append(el('span','',label),el('strong','',value));stats.append(line); }
    this.body.append(stats);
  }
  private drawCraft(s: Rebirth): void {
    this.body.append(el('p','rb-hint','Chaque amélioration est fabriquée à partir de ressources trouvées dans le monde réel virtuel. Aucune microtransaction.'));
    const list=el('div','rb-recipes');
    for(const [id,r] of Object.entries(RECIPES) as [Recipe,typeof RECIPES[Recipe]][]) {
      const row=el('article','rb-recipe');
      const left=el('div','rb-recipe-info');
      left.append(el('strong','',r.title),el('p','',r.desc),
        el('span','rb-recipe-cost',Object.entries(r.cost).map(([k,n])=>n+' '+RESOURCES.find(x=>x.key===k)?.name).join('  ·  ')));
      const available=Object.entries(r.cost).every(([k,n])=>s.resources[k as Resource]>=(n??0));
      const craft=button('FABRIQUER','rb-action',()=>this.act(this.actions.craftItem?.(id)??{ok:false,why:'Indisponible'}));
      craft.disabled=!available||(id==='repair'&&s.integrity===100);
      row.append(left,craft);list.append(row);
    }
    this.body.append(list);
  }
  private drawFactions(s: Rebirth): void {
    this.body.append(el('p','rb-hint','Tes livraisons renforcent Lumen. Les confrontations peuvent dégrader tes relations avec les autres factions.'));
    for(const f of FACTIONS) {
      const row=el('div','rb-faction'), head=el('div','rb-faction-head'), value=s.factions[f.key];
      const label=el('div');label.append(el('strong','',f.label),el('span','rb-muted',f.sub));
      head.append(label,el('strong','',value>0?'+'+value:String(value)));
      const track=el('div','rb-faction-bar'),fill=el('span','');
      fill.style.width=Math.max(0,Math.min(100,(value+100)/2))+'%';track.append(fill);
      row.append(head,track);this.body.append(row);
    }
  }
  private drawRadio(v: GameView, s: Rebirth): void {
    this.body.append(el('div','rb-section-label','SIGNAL / TRANSMISSIONS DÉCODÉES'));
    if(s.radio) {
      const signal=s.radio;
      const node=el('article','rb-radio-card');
      node.append(el('div','rb-radio-scan','●  TRANSMISSION ACTIVE  /  '+signal.source),
        el('h3','rb-radio-title',signal.title),el('p','rb-radio-text',signal.text));
      const disabled=v.player.moving||!!v.player.vehicle;
      const options=el('div','rb-actions');
      const help=button('SECOURIR  ·  +INFLUENCE','rb-action',()=>this.act(this.actions.answerRadio?.('secourir')??{ok:false,why:'Indisponible'}));
      const loot=button('EXTRAIRE  ·  +MATÉRIAUX','rb-action',()=>this.act(this.actions.answerRadio?.('extraire')??{ok:false,why:'Indisponible'}));
      help.disabled=loot.disabled=disabled;
      options.append(help,loot);node.append(options);
      if(disabled)node.append(el('p','rb-hint','Réponds à la transmission lorsque tu es à l’arrêt.'));
      this.body.append(node);
    } else this.body.append(el('p','rb-hint','Aucun signal en attente. Explore de nouveaux secteurs pour intercepter des transmissions.'));
    this.body.append(el('div','rb-section-label','ARCHIVES / JOURNAL DES DÉCISIONS'));
    if(!s.radioLog.length)this.body.append(el('p','rb-hint','Tes premières découvertes apparaîtront ici.'));
    else {
      const list=el('div','rb-radio-log');
      for(const row of [...s.radioLog].reverse().slice(0,12)){
        const [,text] = row.split('|',2);
        list.append(el('p','',text??row));
      }
      this.body.append(list);
    }
  }

  private drawBattle(v: GameView,s: Rebirth): void {
    const e=s.encounter!;
    const stopped=!v.player.moving&&!v.player.vehicle;
    const arena=el('div','rb-arena rb-enemy-'+e.kind);
    this.body.append(arena);
    try {
      this.battle = new CinematicBattle(arena,e);
      this.battle.setMood(e.last.includes('Impulsion') ? 'pulse' : e.last.includes('Coup') ? 'strike' : e.last.includes('défensive') ? 'guard' : 'intro');
    } catch {
      this.battle?.dispose(); this.battle=null;
      arena.append(el('div','rb-arena-fallback','SIGNAL HOSTILE // '+e.name.toUpperCase()));
    }
    arena.append(el('div','rb-signal','CONTACT HOSTILE  //  TOUR '+String(e.turn+1).padStart(2,'0')),
      el('div','rb-arena-bottom','TACTICAL SURVIVAL · STATION LUMEN'));
    this.body.append(el('div','rb-battle-title',e.title),el('p','rb-hint',e.subtitle));
    const stats=el('div','rb-battle-stats');
    const enemy=el('div','rb-battle-hp');enemy.append(el('span','','MENACE  /  '+e.name),el('strong','',e.hp+' / '+e.maxHp),bar(e.hp,e.maxHp,'rb-enemy-hp'));
    const player=el('div','rb-battle-hp');player.append(el('span','','ARMURE  /  PORTEUR'),el('strong','',s.integrity+' / 100'),bar(s.integrity,100,'rb-integrity'));
    stats.append(enemy,player);this.body.append(stats);
    this.body.append(el('p','rb-battle-log',stopped?e.last:'Tu es en déplacement. Immobilise-toi en sécurité pour agir.'));
    const actions=el('div','rb-battle-actions');
    const moves: [CombatMove,string,string][]=[
      ['strike','⚔  ATTAQUER','10–16 dégâts'],
      ['guard','⬡  SE PROTÉGER','Réduit la riposte'],
      ['pulse','ϟ  IMPULSION EMP','Consomme 1 charge'],
      ['evade','↗  SE REPLIER','Tente une retraite']
    ];
    for(const [id,name,info] of moves){
      const b=button(name,'rb-move rb-move-'+id,()=>this.act(this.actions.combatMove?.(id)??{ok:false,why:'Indisponible'}));
      b.append(el('small','',info));b.disabled=!stopped||(id==='pulse'&&s.resources.charges<1);actions.append(b);
    }
    this.body.append(actions,el('p','rb-hint','Combat au tour par tour. Chaque action peut déclencher une contre-attaque. Tu peux fermer l’écran et reprendre plus tard.'));
    this.body.append(el('footer','rb-footer','TACTICAL ENGAGEMENT  //  NO LIVE ACTION REQUIRED'));
  }
}
