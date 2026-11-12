// Version autonome de la même scène WebGL et des mêmes règles tactiques que le jeu.
// Sans GPS, sans compte, sans effets sur la sauvegarde du joueur.
import { CinematicBattle } from './ui/battle3d';
import { freshRebirth, spawnEncounter, kindFor, combat, enemyIntent, INTENT_LABELS, type CombatMove, type EnemyKind, type Rebirth } from './game/rebirth';

const byId = (id:string):HTMLElement => {
  const el=document.getElementById(id);
  if(!el)throw new Error('Élément manquant : '+id);
  return el;
};
const arena=byId('arena'), choices=byId('enemies'), actions=byId('actions');
const message=byId('message'), intent=byId('intent');
const enemyName=byId('enemy-name'), enemyHp=byId('enemy-hp'), enemyFill=byId('enemy-fill');
const armorHp=byId('armor-hp'), armorFill=byId('armor-fill');
const outcome=byId('outcome'), outcomeTitle=byId('outcome-title'), outcomeSub=byId('outcome-sub');
const retry=byId('retry') as HTMLButtonElement;
let stage: CinematicBattle | null=null, selected:EnemyKind='drone', state:Rebirth=freshRebirth(), serial=0;
const moves: {id:CombatMove;name:string;desc:string}[] = [
  {id:'strike',name:'⚔ ATTAQUER',desc:'Dégâts directs et combos'},
  {id:'guard',name:'⬡ PARADE',desc:'Absorbe et contre-attaque'},
  {id:'focus',name:'⌖ CALIBRER',desc:'Charge une frappe critique'},
  {id:'feint',name:'↯ DÉSTABILISER',desc:'Interrompt une charge'},
  {id:'pulse',name:'ϟ IMPULSION EMP',desc:'Neutralisation tactique'},
  {id:'evade',name:'↗ REPLI',desc:'Tente une retraite'},
];
function findEnemy(kind:EnemyKind):string {
  // Identifiant stable mais variable selon les tentatives, conservant un adversaire du type demandé.
  for(let k=serial;k<serial+300;k++){
    const id='simulator:'+kind+':'+k;
    if(kindFor(id)===kind)return id;
  }
  return 'simulator:fallback:'+kind;
}
function start(kind:EnemyKind):void {
  stage?.dispose();stage=null;selected=kind;serial++;
  state=freshRebirth();state.resources.charges=3;
  state.encounter=spawnEncounter(findEnemy(kind));
  outcome.classList.remove('visible');
  stage=new CinematicBattle(arena,state.encounter);
  stage.setMood('intro');
  message.textContent='Analyse du signal : identifie l’action annoncée et choisis ta stratégie.';
  draw();
}
function draw():void {
  const e=state.encounter;
  if(e){
    enemyName.textContent=e.name.toUpperCase();
    enemyHp.textContent=e.hp+' / '+e.maxHp;
    enemyFill.style.width=Math.round(e.hp/e.maxHp*100)+'%';
    intent.textContent='PROCHAIN MOUVEMENT · '+INTENT_LABELS[enemyIntent(e)]+' · PRÉCISION '+e.focus+'/2';
  }else{
    enemyHp.textContent='—';enemyFill.style.width='0%';intent.textContent='CONTACT TERMINÉ';
  }
  armorHp.textContent=state.integrity+' / 100';
  armorFill.style.width=state.integrity+'%';
  for(const el of actions.querySelectorAll('button')) {
    const btn=el as HTMLButtonElement;
    btn.disabled=!e || (btn.dataset.move==='pulse'&&state.resources.charges===0);
  }
  for(const el of choices.querySelectorAll('button'))
    el.classList.toggle('active',(el as HTMLButtonElement).dataset.kind===selected);
}
function act(move:CombatMove):void {
  if(!state.encounter)return;
  const result=combat(state,move);
  if(result.outcome==='invalid'){message.textContent=result.message;return;}
  state=result.state;message.textContent=result.message;
  stage?.setMood(move==='strike'?'strike':move==='pulse'?'pulse':move==='guard'?'guard':'intro');
  if(result.outcome!=='continue'){
    outcome.classList.add('visible');
    outcomeTitle.textContent=result.outcome==='victory'?'MENACE NEUTRALISÉE':
      result.outcome==='escape'?'RETRAITE RÉUSSIE':'SYSTÈME DE SECOURS';
    outcomeSub.textContent='Simulation terminée · aucune conséquence dans ta partie.';
  }
  draw();
}
for(const kind of ['drone','scavenger','stray'] as const){
  const btn=document.createElement('button');
  btn.type='button';btn.dataset.kind=kind;
  btn.textContent=kind==='drone'?'DRONE SENTINELLE':kind==='scavenger'?'RÉCUPÉRATEUR':'ERRANT';
  btn.addEventListener('click',()=>start(kind));
  choices.append(btn);
}
for(const move of moves){
  const btn=document.createElement('button');btn.type='button';btn.dataset.move=move.id;
  btn.textContent=move.name;
  const small=document.createElement('small');small.textContent=move.desc;
  btn.append(small);btn.addEventListener('click',()=>act(move.id));actions.append(btn);
}
retry.addEventListener('click',()=>start(selected));
window.addEventListener('pagehide',()=>stage?.dispose());
start('drone');
