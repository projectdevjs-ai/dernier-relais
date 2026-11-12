// Vérification E2E de la scène WebGL dans Chromium (émulation téléphone).
// Échoue si la scène 3D n'apparaît pas, si les contrôles n'agissent pas ou s'il y a une erreur JavaScript.
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const browser=await chromium.launch({
  headless:true,
  args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'],
});
const context=await browser.newContext({ ...devices['iPhone 13'], browserName:undefined });
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(String(error)));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
  const url='http://127.0.0.1:4173/cinematic-demo.html';
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  if(!response?.ok())throw Error('Page de simulation indisponible : HTTP '+response?.status());
  await page.waitForSelector('.battleground canvas.rb-3d-canvas',{timeout:30000});
  await page.waitForFunction(()=>document.getElementById('arena')?.dataset.assetsReady==='true',null,{timeout:45000});
  await page.waitForFunction(()=>{
    const c=document.querySelector('.battleground canvas');
    return c && c.width>120 && c.height>100;
  });
  const first=await page.locator('#enemy-name').innerText();
  if(!first.toLowerCase().includes('drone'))throw Error('Le drone ne s’affiche pas : '+first);
  const before=await page.locator('#message').innerText();
  await page.locator('button[data-move="focus"]').click();
  await page.waitForFunction(old=>document.querySelector('#message')?.textContent!==old,before);
  if(!(await page.locator('#intent').innerText()).includes('PRÉCISION 1/2'))
    throw Error('Le calibrage tactique ne fonctionne pas');
  await page.locator('button[data-move="strike"]').click();
  const after=await page.locator('#enemy-hp').innerText();
  if(after.startsWith('34 /'))throw Error('La frappe ne modifie pas les PV ennemis');
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,window.innerWidth]);
  if(width[0]>width[1]+4)throw Error('Débordement horizontal mobile : '+width.join('/'));
  await mkdir('/tmp/rebirth-test',{recursive:true});
  await page.screenshot({path:'/tmp/rebirth-test/cinematic-mobile.png',fullPage:true});
  await page.locator('button[data-kind="scavenger"]').click();
  await page.waitForFunction(()=>document.getElementById('arena')?.dataset.assetsReady==='true',null,{timeout:45000});
  if(!(await page.locator('#enemy-name').innerText()).toLowerCase().includes('récupérateur'))
    throw Error('Changement d’ennemi impossible');
  await page.screenshot({path:'/tmp/rebirth-test/scavenger-mobile.png',fullPage:true});
  await page.locator('button[data-kind="stray"]').click();
  await page.waitForFunction(()=>document.getElementById('arena')?.dataset.assetsReady==='true',null,{timeout:45000});
  await page.screenshot({path:'/tmp/rebirth-test/stray-mobile.png',fullPage:true});
  if(errors.length)throw Error('Erreurs navigateur : '+errors.slice(0,5).join(' | '));
  console.log('PASS : WebGL 3D, rendu mobile, actions tactiques, PV, sélection d’ennemi, captures.');
} finally {
  await browser.close();
}
