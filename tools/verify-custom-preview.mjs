import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
await mkdir('.cache',{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];await page.setViewport({width:1280,height:900});page.on('pageerror',e=>errors.push(e.message));await page.goto((process.env.SP_URL||'http://localhost:3000')+'/dev/custom-battle.html');await page.waitForFunction(()=>customBattle?.ready);
 const report=await page.evaluate(()=>{
  customBattle.paused=true;const rows=[];
  for(const operator of ['wang','chen3','kalts2','oblvns','wisdel'])for(const elite of [false,true])for(const skill of [operator==='kalts2'?1:2]){
   document.getElementById('operator').value=operator;document.getElementById('operator').onchange();document.getElementById('elite').checked=elite;document.getElementById('skill').value=String(skill);customBattle.start();customBattle.advance(8);
   const b=customBattle.battle,u=customBattle.unit,t=b.allyUnits.find(t=>t.uid===102);
   rows.push({operator,elite,skill,damage:u.stats.dmg,healing:u.stats.heal,movementComplete:operator==='kalts2'&&skill===2&&u.mem.kaltsMoveCharges===2&&(u.tileR!==u.homeR||u.tileC!==u.homeC),errors:b.errors,deployable:!t||b.grid.canStand(t.homeR,t.homeC,{ranged:true})});
  }
  const cycles=[];
  for(const elite of [false,true]){
   document.getElementById('operator').value='wang';document.getElementById('operator').onchange();document.getElementById('elite').checked=elite;document.getElementById('skill').value='2';customBattle.start();
   const b=customBattle.battle,u=customBattle.unit,starts=[],hits=[];
   b.on('skillStart',c=>{if(c.unit===u)starts.push({time:b.time,stock:u.mem.wang.stock});});
   b.on('damaged',c=>{if(c.dmg.tags?.includes('wang:stone'))hits.push({time:b.time,amount:c.amount});});
   customBattle.advance(240);cycles.push({elite,starts,hits,errors:b.errors});
  }
  const bursts=[];
  for(const elite of [false,true])for(const inside of [true,false])for(const resistance of [0,60]){
   document.getElementById('wang-res').value=String(resistance);
   document.getElementById('elite').checked=elite;document.getElementById(inside?'wang-inside':'wang-outside').click();customBattle.advance(2);
   const b=customBattle.battle,u=customBattle.unit;bursts.push({elite,inside,result:customBattle.lastAction,...customBattle.burst,ammo:u.skill.ammoLeft,displayedDamage:customBattle.damage,errors:b.errors,valid:customBattle.burst.placements.every(p=>(b.grid.canStand(p.row,p.col,{ranged:true})||b.grid.groundPassable(p.row,p.col)))});
  }
  return {rows,cycles,bursts,errors:customBattle.errors};
 });
 assert.equal(report.rows.length,10);assert.deepEqual(errors,[]);assert.deepEqual(report.errors,[]);
 for(const row of report.rows){assert.deepEqual(row.errors,[]);assert.equal(row.deployable,true);assert.ok(row.damage>0||row.healing>0||row.movementComplete,JSON.stringify(row));}
 for(const cycle of report.cycles){assert.deepEqual(cycle.errors,[]);assert.ok(cycle.starts.length>=2);for(const start of cycle.starts){assert.equal(start.stock,8);assert.ok(cycle.hits.some(h=>h.time>=start.time&&h.time<start.time+30&&h.amount>0));}}
 await writeFile('.cache/wang-burst-debug.json',JSON.stringify(report.bursts,null,2));
 for(const v of report.bursts){assert.deepEqual(v.errors,[]);assert.equal(v.result.ok,true);assert.equal(v.valid,true);assert.equal(v.placements.length,v.inside?4:1);assert.equal(v.ammo,v.inside?17:20);assert.equal(v.hits.length,v.inside?5:2);for(const [i,h]of v.hits.entries()){const layers=v.inside&&i>=3?3:2,expected=v.attack*(v.elite?3.2:2.9)*(1+layers*(v.elite?.15:.12))*Math.max(.05,1-Math.max(0,v.resistance-layers*(v.elite?13:10))/100);assert.ok(Math.abs(h.amount-expected)<1e-6,JSON.stringify({h,expected,v}));assert.equal(h.penetration,layers*(v.elite?13:10));assert.ok(Math.abs(h.hpLoss-expected)<1e-6);}assert.equal(new Set(v.hits.map(h=>h.piece)).size,v.hits.length);assert.ok(Math.abs(v.displayedDamage-v.hits.reduce((sum,h)=>sum+h.amount,0))<1e-6);for(const [i,p]of v.placements.entries())assert.ok(Math.abs(p.time-i*.3)<1e-6);}
 if(process.env.SP_SCREENSHOT){await page.evaluate(()=>{document.getElementById('wang-res').value='0';document.getElementById('wang-inside').click();customBattle.advance(2);});await page.screenshot({path:process.env.SP_SCREENSHOT,fullPage:true});}
 if(process.env.SP_OUTSIDE_SCREENSHOT){await page.evaluate(()=>{document.getElementById('wang-outside').click();customBattle.advance(2);});await page.screenshot({path:process.env.SP_OUTSIDE_SCREENSHOT,fullPage:true});}
 await writeFile('.cache/preview-matrix-report.json',JSON.stringify(report,null,2));console.log('PASS: 10 rendered battle fixtures progress without errors and produce damage, healing or completed movement; all preset Wang tiles are deployable; normal/elite Wang automatically refill and damage across subsequent rendered cycles; 8 inside/outside RES0/60 fixtures match per-piece formulas, penetration, actual HP loss and displayed totals.');
}finally{await browser.close();}

