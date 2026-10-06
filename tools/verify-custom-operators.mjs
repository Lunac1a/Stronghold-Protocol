#!/usr/bin/env node
// Requires npm start. Checks the real browser loader against Node for the five requested skills, in normal and elite forms.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import {buildBattleSpec,createBattleFromSpec,resultDigest} from '../server/sim/spec.js';
import {getDefaultSource} from '../server/sim/simdata.js';
import {CUSTOM_OPERATORS} from './custom-operators.mjs';
const specs=CUSTOM_OPERATORS.flatMap(o=>['a','b'].flatMap(form=>[o.skillIndex].map(skillIndex=>buildBattleSpec({battleId:o.key+form+skillIndex,kind:'normal',stageId:'act2autochess_m04',seed:487,round:7,timeLimit:45,
 players:[{playerId:'p1',dir:'RIGHT',units:[{uid:100,kind:'chess',chessId:`chess_custom_${o.tier}_${o.key}_${form}`,row:10,col:5,skillIndex},{uid:101,kind:'chess',chessId:'chess_char_1_01_a',row:11,col:6},...(o.key==='wang'?[{uid:102,kind:'token',tokenId:'token_10064_wang_stone1',ownerUid:100,row:10,col:6}]:[]),...(o.key==='kalts2'&&skillIndex===2?[{uid:103,kind:'token',tokenId:'token_10068_kalts2_mtship',ownerUid:100,row:10,col:10}]:[])]}],
 spawns:[{enemyKey:'enemy_1007_slime',count:20,interval:0.5,time:0,route:0}],flags:{startOpCooldown:0}}))));
const run=(spec,api,ds)=>{const b=api.createBattleFromSpec(spec,ds,{quiet:true});const r=b.runToEnd(4000);return {digest:api.resultDigest(r),errors:b.errors};};
const node=specs.map(s=>run(s,{createBattleFromSpec,resultDigest},getDefaultSource()));
const browser=await puppeteer.launch({executablePath:process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run','--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto(process.env.SP_URL||'http://localhost:3000');
 const chrome=await page.evaluate(async(specs,fn)=>{const {loadBrowserSim}=await import('/js/battle/runner.js');const {spec,ds}=await loadBrowserSim();const run=new Function('return ('+fn+')')();return specs.map(s=>run(s,spec,ds));},specs,run.toString());
 assert.deepEqual(chrome,node);assert.ok(node.every(r=>!r.errors.length));console.log(`PASS: ${specs.length} loadouts have identical Chrome/Node results, without simulation errors.`);
}finally{await browser.close();}
