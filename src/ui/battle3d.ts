// DERNIER RELAIS / CINEMATIC ENCOUNTER
// Scène de combat WebGL réellement animée, sans serveur, asset distant ou texture téléchargée.
// Les formes sont construites par assemblage de géométries légères pour le Web mobile.
import * as THREE from 'three';
import type { Encounter } from '../game/rebirth';

type EnemyKind = Encounter['kind'];
type CombatMood = 'intro' | 'strike' | 'guard' | 'pulse' | 'evade' | 'victory' | 'defeat';
const TAU = Math.PI * 2;
function mat(color: number, metalness = .18, roughness = .72, emissive = 0x000000): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: .6, flatShading: true });
}
const stone = [mat(0x29333b), mat(0x394346), mat(0x252e34), mat(0x465047)];
const metal = mat(0x657079,.72,.36), dark = mat(0x18252c,.6,.4);
const armor = mat(0x424e4d,.46,.47), cloth = mat(0x393f3f,.05,.93);
const red = mat(0xff6755,.15,.45,0xe54737), cyan = mat(0x8dd4c2,.08,.35,0x359c93);
const gold = mat(0xb9a785,.55,.46), black = mat(0x131a20,.6,.6);
const scavSuit = mat(0x6b5950), straySuit = mat(0x5c6260), floorMat = mat(0x2d3537,.08,.93);
const materials: THREE.Material[] = [...stone,metal,dark,armor,cloth,red,cyan,gold,black,scavSuit,straySuit,floorMat];
const boxGeo = new THREE.BoxGeometry(1,1,1);
const sphereGeo = new THREE.IcosahedronGeometry(1,1);
const cylinderGeo = new THREE.CylinderGeometry(1,1,1,8);
const sharedGeos: THREE.BufferGeometry[] = [boxGeo,sphereGeo,cylinderGeo];
function box(parent: THREE.Object3D, material: THREE.Material, xyz: [number,number,number], size: [number,number,number], angle = 0): THREE.Mesh {
  const b = new THREE.Mesh(boxGeo,material);
  b.position.set(...xyz); b.scale.set(...size); b.rotation.y=angle; b.castShadow=true; b.receiveShadow=true;
  parent.add(b);return b;
}
function sphere(parent: THREE.Object3D, material: THREE.Material, xyz: [number,number,number], size: [number,number,number]): THREE.Mesh {
  const b=new THREE.Mesh(sphereGeo,material);b.position.set(...xyz);b.scale.set(...size);b.castShadow=true;parent.add(b);return b;
}
function cylinder(parent: THREE.Object3D,material:THREE.Material,xyz:[number,number,number], size:[number,number,number],segments=8):THREE.Mesh {
  const geo=segments===8?cylinderGeo:new THREE.CylinderGeometry(1,1,1,segments);
  const b=new THREE.Mesh(geo,material);b.position.set(...xyz);b.scale.set(...size);b.castShadow=true;parent.add(b);return b;
}
function line(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, material: THREE.Material, r = .05): THREE.Mesh {
  const delta=new THREE.Vector3().subVectors(b,a);
  const mesh=cylinder(parent,material,[0,0,0],[r,delta.length(),r]);
  mesh.position.copy(a).addScaledVector(delta,.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
  return mesh;
}
function pseudo(seed: number): () => number {
  let x=seed>>>0;return ()=>{x=(x*1664525+1013904223)>>>0;return x/4294967296;};
}
function humanoid(kind: EnemyKind): {root:THREE.Group; head:THREE.Group; armL:THREE.Group; armR:THREE.Group;} {
  const root=new THREE.Group(), head=new THREE.Group(), armL=new THREE.Group(), armR=new THREE.Group();
  const scav=kind==='scavenger', suit=scav?scavSuit:kind==='stray'?straySuit:armor;
  const trim=scav?gold:cyan;
  root.add(head,armL,armR);
  // Bottes, tibias, genouillères, hanche, torse et harnais visibles depuis la caméra.
  for(const side of [-1,1]){
    box(root,dark,[side*.47,.30,.02],[.48,.55,.80]);
    box(root,suit,[side*.46,.92,-.10],[.40,.96,.46],side*.05);
    box(root,metal,[side*.45,1.20,-.37],[.48,.27,.20]);
    box(root,cloth,[side*.42,1.7,.10],[.46,.65,.50]);
    box(root,metal,[side*.45,.33,-.41],[.5,.19,.16]);
  }
  box(root,dark,[0,1.86,0],[1.34,.65,.68]);
  box(root,suit,[0,2.43,-.08],[1.47,1.18,.72]);
  box(root,armor,[0,2.50,-.51],[1.22,.65,.17]);
  box(root,trim,[0,2.70,-.63],[.66,.08,.075]);
  // Platines mécaniques dorsales et sac de terrain.
  box(root,dark,[0,2.45,.52],[1.20,1.15,.55]);
  for(const side of [-1,1])box(root,metal,[side*.50,2.60,.77],[.15,.90,.15]);
  head.position.set(0,3.20,-.06);
  box(head,dark,[0,.04,.0],[.70,.72,.62]);
  box(head,suit,[0,.20,-.07],[.83,.44,.69]);
  box(head,black,[0,.08,-.38],[.64,.22,.12]);
  for(const x of [-.19,.19])box(head,trim,[x,.08,-.47],[.23,.07,.07]);
  box(head,metal,[0,-.19,-.29],[.35,.13,.19]);
  for(const side of [-1,1]) {
    const arm=side===-1?armL:armR;
    arm.position.set(side*.92,2.82,0);
    box(arm,suit,[side*.05,-.27,0],[.44,.66,.46],side*.09);
    box(arm,metal,[0,-.79,-.13],[.45,.38,.47]);
    box(arm,cloth,[0,-1.16,-.17],[.36,.58,.42]);
    box(arm,dark,[0,-1.51,-.22],[.41,.33,.43]);
    box(root,metal,[side*.92,2.84,0],[.58,.35,.58],side*.10);
  }
  if(scav) {
    // Silhouette asymétrique de récupérateur : antenne, pièce d'armure, paquetage.
    box(root,gold,[-.78,2.71,-.13],[.42,.55,.84],-.12);
    line(root,new THREE.Vector3(.28,2.9,.6),new THREE.Vector3(.56,4.7,.8),metal,.052);
    sphere(root,red,[.56,4.7,.8],[.11,.11,.11]);
    box(root,metal,[.22,2.0,.83],[.57,.54,.43]);
  } else if(kind==='stray') {
    // Capuche, cape déchirée et masque.
    box(root,cloth,[0,3.48,.15],[1.12,.50,.87]);
    box(root,cloth,[.48,2.27,.49],[.43,1.55,.12],-.1);
    box(root,cloth,[-.49,2.15,.49],[.42,1.75,.12],.09);
  } else {
    // Sentinelle humanoïde mécanique : radiateur dorsal et noyau lumineux.
    box(root,cyan,[0,2.50,-.65],[.32,.3,.09]);
    for(let y=2.04;y<2.9;y+=.20)box(root,metal,[0,y,.89],[.63,.08,.17]);
  }
  return {root,head,armL,armR};
}
function drone():{root:THREE.Group; propellers:THREE.Group[]; eye:THREE.Mesh} {
  const root=new THREE.Group();
  const propellers:THREE.Group[]=[];
  sphere(root,armor,[0,0,0],[1.6,.36,.85]);
  box(root,metal,[0,.27,0],[2.4,.28,1.33]);
  box(root,dark,[0,-.26,.27],[1.45,.42,1.05]);
  box(root,red,[0,-.17,-.88],[.45,.22,.18]);
  const eye=sphere(root,red,[0,-.14,-.94],[.21,.16,.22]);
  for(const side of [-1,1]) {
    for(const end of [-1,1]){
      const x=side*2.48,z=end*1.25;
      line(root,new THREE.Vector3(side*.95,0,end*.4),new THREE.Vector3(x,0,z),metal,.15);
      cylinder(root,dark,[x,.05,z],[.50,.20,.50],12);
      const rotor=new THREE.Group();rotor.position.set(x,.25,z);
      for(const axis of [0,Math.PI/2])box(rotor,metal,[0,0,0],[1.55,.035,.18],axis);
      root.add(rotor);propellers.push(rotor);
      sphere(root,cyan,[x,-.20,z],[.12,.1,.12]);
    }
  }
  for(const side of [-1,1])line(root,new THREE.Vector3(side*.67,-.23,.45),new THREE.Vector3(side*1.02,-1.05,.67),metal,.095);
  return {root,propellers,eye};
}
function ruins(parent:THREE.Object3D):void {
  const rand=pseudo(2637);
  // Gare abandonnée : deux alignements de ruines, routes fendillées, consoles et poutres.
  for(let i=0;i<23;i++){
    const side=i%2===0?-1:1;
    const z=-10-(i*1.7+rand()*4),x=side*(9+rand()*8);
    const width=2.5+rand()*4,height=2+rand()*13;
    const building=new THREE.Group();building.position.set(x,0,z);
    parent.add(building);
    box(building,stone[i%stone.length],[0,height*.5,0],[width,height,2.7+rand()*3],(rand()-.5)*.11);
    for(let j=0;j<3;j++){
      const wx=(j-1)*width*.24;
      box(building,dark,[wx,height*.6,-(2.7)*.5-.05],[width*.13,height*.13,.08]);
      box(building,gold,[wx,height*.6,-(2.7)*.5-.095],[width*.05,.02,.02]);
    }
    if(i%3===0) {
      box(building,metal,[0,height+.3,0],[width+.6,.27,3.2]);
      box(building,dark,[0,height+1,0],[width*.55,1,.4]);
    }
  }
  for(let i=0;i<34;i++){
    const z=-1-rand()*30,x=(rand()-.5)*17;
    box(parent,stone[i%stone.length],[x,.06,z],[.4+rand()*1.8,.15,.4+rand()*1.4],rand()*TAU);
  }
  // Rails et pylônes aident à lire la perspective.
  for(const x of [-4.7,4.7]) {
    box(parent,metal,[x,.025,-18],[.13,.08,42]);
    for(let i=0;i<17;i++)box(parent,stone[i%stone.length],[x,.09,2-i*2.6],[.65,.17,.21]);
  }
  for(let i=0;i<6;i++){
    const z=2-i*6.7,side=i%2?-1:1;
    const x=side*8.5;
    line(parent,new THREE.Vector3(x,0,z),new THREE.Vector3(x,7.2,z),metal,.11);
    line(parent,new THREE.Vector3(x,7.2,z),new THREE.Vector3(x-side*1.4,7.2,z),metal,.09);
    box(parent,gold,[x-side*1.4,7.05,z],[.6,.12,.4]);
  }
}
export class CinematicBattle {
  private scene=new THREE.Scene();
  private cam=new THREE.PerspectiveCamera(40,1,.1,170);
  private renderer:THREE.WebGLRenderer|null=null;
  private enemy=new THREE.Group();
  private fighter=new THREE.Group();
  private head:THREE.Group|null=null;
  private armL:THREE.Group|null=null;
  private armR:THREE.Group|null=null;
  private rotors:THREE.Group[]=[];
  private dust:THREE.Points|null=null;
  private ring:THREE.Mesh|null=null;
  private glow:THREE.PointLight|null=null;
  private frame=0;
  private t=0;
  private prev=0;
  private observed:ResizeObserver|null=null;
  private stopped=false;
  private visible=false;
  private mood:CombatMood='intro';
  private actionAt=0;
  private isDrone=false;
  private mouse=0;
  private dragId: number | null = null;
  private dragStart = 0;
  private dragBearing = 0;
  private readonly reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly onVisibility=():void=>{this.visible=!document.hidden; if(this.visible&&!this.frame) this.frame=requestAnimationFrame(this.tick);};
  constructor(private container:HTMLElement, encounter:Encounter) {
    this.isDrone=encounter.kind==='drone';
    this.scene.background=new THREE.Color(encounter.kind==='drone'?0x101b29:encounter.kind==='stray'?0x191a1f:0x161e21);
    this.scene.fog=new THREE.FogExp2(this.scene.background as THREE.Color,.033);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.24;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.domElement.className='rb-3d-canvas';
    this.renderer.domElement.setAttribute('aria-label','Scène de combat 3D animée');
    this.container.append(this.renderer.domElement);
    const hemi=new THREE.HemisphereLight(0xc4dde0,0x252b2c,1.5);this.scene.add(hemi);
    const sun=new THREE.DirectionalLight(0xf9d0a0,3.0);
    sun.position.set(-8,15,-13);sun.castShadow=true;sun.shadow.mapSize.set(512,512);
    sun.shadow.camera.left=-19;sun.shadow.camera.right=19;sun.shadow.camera.top=19;sun.shadow.camera.bottom=-19;
    sun.shadow.normalBias=.03;this.scene.add(sun);
    const rim=new THREE.PointLight(0x96c2c2,75,20,2);rim.position.set(7,9,-6);this.scene.add(rim);
    this.glow=new THREE.PointLight(0xf96554,5,10,2);this.scene.add(this.glow);
    // Dalle de station et scène de l'ancien monde.
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),floorMat);
    ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;this.scene.add(ground);
    ruins(this.scene);
    const rand=pseudo(7);
    for(let i=0;i<65;i++){
      const x=(rand()-.5)*30,z=(rand()-.5)*40-7;
      const fragment=new THREE.Mesh(boxGeo,stone[i%stone.length]);
      fragment.position.set(x,.04,z);fragment.scale.set(.12+rand()*.7,.07,.08+rand()*.65);
      fragment.rotation.y=rand()*TAU;fragment.receiveShadow=true;this.scene.add(fragment);
    }
    this.ring=new THREE.Mesh(new THREE.TorusGeometry(2.3,.045,4,64),new THREE.MeshBasicMaterial({color:0xfb8d64,transparent:true,opacity:.7}));
    this.ring.rotation.x=-Math.PI/2;this.ring.position.set(0,.11,-1.25);this.scene.add(this.ring);
    const rings=new THREE.Mesh(new THREE.TorusGeometry(2.62,.023,4,64),new THREE.MeshBasicMaterial({color:0x9abca9,transparent:true,opacity:.55}));
    rings.rotation.x=-Math.PI/2;rings.position.set(0,.105,-1.25);this.scene.add(rings);
    if(this.isDrone){
      const d=drone();this.enemy=d.root;this.rotors=d.propellers;
      this.enemy.position.set(0,4.8,-2);
    }else{
      const d=humanoid(encounter.kind);this.enemy=d.root;this.head=d.head;this.armL=d.armL;this.armR=d.armR;
      this.enemy.position.set(0,0,-2);
    }
    this.scene.add(this.enemy);
    const player=humanoid('drone');this.fighter=player.root;
    player.root.position.set(-5,0,3.9);
    player.root.rotation.y=.46;
    // Le joueur est toujours orienté vers la menace.
    player.root.scale.setScalar(.87);this.scene.add(this.fighter);
    const count=175,positions=new Float32Array(count*3);
    for(let i=0;i<count;i++){positions[i*3]=(rand()-.5)*28;positions[i*3+1]=rand()*13;positions[i*3+2]=-(rand()*32);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.dust=new THREE.Points(geo,new THREE.PointsMaterial({color:0xd7bb96,size:.058,transparent:true,opacity:.33,depthWrite:false}));
    this.scene.add(this.dust);
    this.cam.position.set(10,7.5,17);
    this.cam.lookAt(0,2.9,-1.1);
    this.observed=new ResizeObserver(()=>this.resize());
    this.observed.observe(this.container);
    this.resize();
    this.visible=!document.hidden;
    document.addEventListener('visibilitychange',this.onVisibility);
    this.container.addEventListener('pointermove',this.move);
    this.container.addEventListener('pointerdown',this.down);
    this.container.addEventListener('pointerup',this.up);
    this.container.addEventListener('pointercancel',this.up);
    if(this.visible)this.frame=requestAnimationFrame(this.tick);
  }
  private readonly down=(e:PointerEvent):void=>{
    if(this.dragId!==null)return;
    this.dragId=e.pointerId;this.dragStart=e.clientX;this.dragBearing=this.mouse;
    this.container.setPointerCapture?.(e.pointerId);
  };
  private readonly up=(e:PointerEvent):void=>{
    if(e.pointerId===this.dragId)this.dragId=null;
  };
  private readonly move=(e:PointerEvent):void=>{
    if(this.dragId===e.pointerId){
      const width=Math.max(1,this.container.clientWidth);
      this.mouse=THREE.MathUtils.clamp(this.dragBearing+(e.clientX-this.dragStart)/width,-1,1);
    }else if(e.pointerType==='mouse' && this.dragId===null && this.container.clientWidth){
      this.mouse=THREE.MathUtils.clamp((e.offsetX/this.container.clientWidth-.5)*1.2,-.7,.7);
    }
  };
  setMood(mood:CombatMood):void {this.mood=mood;this.actionAt=this.t;}
  private resize():void {
    if(!this.renderer)return;
    const w=Math.max(2,this.container.clientWidth),h=Math.max(2,this.container.clientHeight);
    this.renderer.setSize(w,h,false);this.cam.aspect=w/h;this.cam.fov=h<220?47:40;this.cam.updateProjectionMatrix();
  }
  private readonly tick=(time:number):void=>{
    this.frame=0;
    if(this.stopped||!this.renderer||!this.visible)return;
    this.frame=requestAnimationFrame(this.tick);
    const dt=this.prev?Math.min(.05,(time-this.prev)/1000):0;
    this.prev=time;this.t+=dt;
    const speed=this.reduce ? 0.3 : 1;
    const t=this.t*speed, elapsed=this.t-this.actionAt;
    const intro=this.reduce?1:Math.min(1,this.t/2.4);
    const ease=1-(1-intro)**3;
    const angle=.18+this.mouse*.22+Math.sin(t*.12)*.045;
    const cameraRadius=19.5-(ease*3.5);
    this.cam.position.set(Math.sin(.58+angle)*cameraRadius,7.2+Math.sin(t*.25)*.2,
      Math.cos(.58+angle)*cameraRadius);
    this.cam.position.x-=2.9;
    this.cam.lookAt(-.5,2.55,-1.8);
    if(this.isDrone){
      this.enemy.position.y=4.6+Math.sin(t*2.3)*.24;
      this.enemy.rotation.y=Math.sin(t*.42)*.14;
      for(const [i,rotor] of this.rotors.entries())rotor.rotation.y+=dt*(i%2?18:-18);
    }else{
      this.enemy.position.y=Math.sin(t*2)*.05;
      this.enemy.rotation.y=Math.sin(t*.55)*.075;
      if(this.head)this.head.rotation.y=Math.sin(t*.7)*.06;
      if(this.armL)this.armL.rotation.x=Math.sin(t*1.7)*.08;
      if(this.armR)this.armR.rotation.x=-Math.sin(t*1.7)*.08;
    }
    this.fighter.position.y=Math.sin(t*1.4)*.035;
    if(this.ring){
      const v=1+Math.sin(t*2.4)*.065;
      this.ring.scale.setScalar(v);
      (this.ring.material as THREE.MeshBasicMaterial).opacity=.42+Math.sin(t*2)*.18;
    }
    if(this.dust)this.dust.rotation.y=t*.003;
    if(this.glow){
      const action=elapsed<.6?Math.sin(elapsed/.6*Math.PI):0;
      const pulse=this.mood==='pulse'?12:this.mood==='strike'?6:0;
      this.glow.position.set(0,this.isDrone?4.4:2.5,-2.7);
      this.glow.intensity=5+Math.sin(t*3)*1.5+pulse*action;
      if(this.mood==='strike'&&action>0)this.enemy.position.x=Math.sin(elapsed*35)*.12*action;
      if(this.mood==='pulse'&&action>0)this.enemy.rotation.z=Math.sin(elapsed*23)*.06*action;
    }
    this.renderer.render(this.scene,this.cam);
  };
  dispose():void{
    if(this.stopped)return;this.stopped=true;
    cancelAnimationFrame(this.frame);this.frame=0;
    document.removeEventListener('visibilitychange',this.onVisibility);
    this.container.removeEventListener('pointermove',this.move);
    this.container.removeEventListener('pointerdown',this.down);
    this.container.removeEventListener('pointerup',this.up);
    this.container.removeEventListener('pointercancel',this.up);
    this.observed?.disconnect();this.observed=null;
    this.scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Points){
      const g=o.geometry as THREE.BufferGeometry;
      if(!sharedGeos.includes(g))g.dispose();
      const m=o.material as THREE.Material|THREE.Material[];
      for(const v of Array.isArray(m)?m:[m])if(!materials.includes(v))v.dispose();
    }});
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer=null;
  }
}
