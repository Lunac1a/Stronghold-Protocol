// Four real browser sessions against a temporary local server; fixture boards bypass drafting only.
// SP_FORM=elite selects promoted recruits; CHROME and SP_SCREENSHOT are optional.
import puppeteer from 'puppeteer-core';
import {createBattleFromSpec,resultDigest,compactResult} from '../server/sim/spec.js';
import {validateClientResult} from '../server/match/fields.js';
import {GameData} from '../server/match/gamedata.js';
import {getData} from '../server/data.js';
import {getDefaultSource} from '../server/sim/simdata.js';
const elite=process.env.SP_FORM==='elite';
import {startServer} from '../server/index.js';
import {Match} from '../server/match/Match.js';
import {tileKey} from '../server/match/board.js';
const recruits=['chess_custom_6_wang_a','chess_custom_5_chen3_a','chess_custom_5_kalts2_a','chess_custom_6_oblvns_a','chess_custom_5_wisdel_a'];
const settled=[];
class FixtureMatch extends Match{
 settle(plan,result){settled.push({digest:resultDigest(result),round:this.round});return super.settle(plan,result);}
 _uniteOpts(){return {seed:417,kind:'unite',stageId:this.stageId,round:1,timeLimit:30,rect:{r0:9,r1:16,c0:0,c1:20},flags:{startOpCooldown:0},
 players:[...this.players.values()].map((p,i)=>({playerId:p.playerId,dir:'RIGHT',units:recruits.map((chessId,j)=>({uid:100+i*100+j,chessId:elite?chessId.replace(/_a$/,'_b'):chessId,row:9+j,col:3+i*4,skillIndex:j===2?1:2}))})),
 routes:[{start:[11,18],end:[11,18],motion:'WALK',checkpoints:[{type:'WAIT',time:1000}]}],spawns:[{enemyKey:'enemy_1007_slime',sourcePlayerId:[...this.players.keys()][0],count:30,interval:.5,time:0,route:0}]};}
 start(){this.round=1;this.stageId='act2autochess_m04';this.stage=this.gd.stage(this.stageId);this.wave={timeLimit:30,spawns:[],routes:[]};
 this.startUnite({helpers:[...this.players.values()],leakers:[],leaked:[],notReentered:new Map()});this.markPublic();this.flush(true);}
}
const server=await startServer({port:0,host:'127.0.0.1',MatchClass:FixtureMatch,log:{info(){},warn(){},error(...e){console.error(...e)}}});
const browser=await puppeteer.launch({executablePath:process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu','--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
try{
 const pages=[],errors=[];
 for(let i=0;i<4;i++){const context=await browser.createBrowserContext(),p=await context.newPage();pages.push(p);await p.setViewport({width:1500,height:1000});p.on('pageerror',e=>errors.push(e.message));await p.goto(server.url);
  await p.evaluate(async name=>{const {net}=await import('/js/net.js');net.setName(name);},`联防玩家${i+1}`);
  await p.waitForFunction(async()=>{const {net}=await import('/js/net.js');return net.status==='online';},{timeout:30000});await p.evaluate(async()=>{const {store}=await import('/js/store.js');store.patch('session',{entered:true});});
 }
 await pages[0].evaluate(async()=>{const {net}=await import('/js/net.js');await net.request('room.create',{mode:'coop',difficulty:'NORMAL'});});
 const code=await pages[0].evaluate(async()=>{const {store}=await import('/js/store.js');return store.get().room.code;});
 for(const p of pages.slice(1))await p.evaluate(async code=>{const {net}=await import('/js/net.js');await net.request('room.join',{code});},code);
 for(const p of pages.slice(1))await p.evaluate(async()=>{const {net}=await import('/js/net.js');await net.request('room.ready',{ready:true});});
 await pages[0].evaluate(async()=>{const {net}=await import('/js/net.js');await net.request('room.start',{});});
 for(const p of pages){try{await p.waitForFunction(async()=>{const {battleRunner}=await import('/js/battle/runner.js');return globalThis.__SP_VIEW__&&battleRunner.state()?.kind==='unite';},{timeout:30000});}catch(error){console.log(JSON.stringify(await p.evaluate(async()=>{const {store}=await import('/js/store.js'),{battleRunner}=await import('/js/battle/runner.js');const s=store.get();return {screen:s.screen,phase:s.match.public?.phase,field:s.match.field,state:battleRunner.state(),private:!!s.match.private,text:document.body.innerText.slice(0,1000)};})));console.log(JSON.stringify(errors));throw error;}}
 for(const p of pages)await p.waitForFunction(async()=>{const {battleRunner}=await import('/js/battle/runner.js');return [...battleRunner._entries.values()][0]?.battle.tickCount>=90;},{timeout:30000});
 const results=[];
 for(const p of pages)results.push(await p.evaluate(async()=>{const {battleRunner,loadBrowserSim}=await import('/js/battle/runner.js');const e=[...battleRunner._entries.values()][0],api=await loadBrowserSim();const b=api.spec.createBattleFromSpec(e.spec,api.ds,{quiet:true});for(let i=0;i<90;i++)b.step();return {authoritative:e.authoritative,players:e.spec.players.length,skills:e.spec.players.flatMap(p=>p.units).filter(u=>u.kind!=='token').map(u=>u.skillIndex),spec:e.spec,digest:api.spec.resultDigest(b.runToEnd(4000)),snapshot:b.snapshot(),errors:[...e.battle.errors,...b.errors]};}));
 const serverBattle=createBattleFromSpec(results[0].spec,getDefaultSource(),{quiet:true}),serverRaw=serverBattle.runToEnd(4000),serverDigest=resultDigest(serverRaw);if(serverBattle.errors.length||results.some(r=>JSON.stringify(r.digest)!==JSON.stringify(serverDigest)))throw Error('Full battle Chrome/Node result mismatch');
 const reference=JSON.stringify(results[0].snapshot);if(results.some(r=>r.players!==4||r.skills.length!==20||r.skills.some((s,i)=>s!==(i%5===2?1:2))||r.errors.length||JSON.stringify(r.snapshot)!==reference)||errors.length)throw Error('Four-browser selected-skill replica mismatch');
 console.log(JSON.stringify({checkpoint:'waiting-for-live-settlement',form:elite?'elite':'normal'}));
 for(const p of pages)await p.waitForFunction(async()=>{const {store}=await import('/js/store.js');return ['SETTLE','PREP','SP_DRAFT','ENDED'].includes(store.get().match.public?.phase);},{timeout:60000});
 const normalized=validateClientResult(results[0].spec,compactResult(serverRaw),{gd:new GameData(getData(),'mode_multi_normal')});if(!normalized.ok)throw Error('Expected replay failed result validation: '+normalized.reason);const expectedSettlement=resultDigest(normalized.result);
 if(settled.length!==1||JSON.stringify(settled[0].digest)!==JSON.stringify(expectedSettlement)){console.log(JSON.stringify({settled,serverDigest}));throw Error('Live room settlement result differs from replay');}
 const phases=await Promise.all(pages.map(p=>p.evaluate(async()=>{const {store}=await import('/js/store.js');return store.get().match.public?.phase;})));
 console.log(JSON.stringify({liveSettlement:true,phases,digest:settled[0].digest.hash}));
 if(process.env.SP_SCREENSHOT)await pages[0].screenshot({path:process.env.SP_SCREENSHOT,fullPage:true});console.log(JSON.stringify({pass:true,form:elite?'elite':'normal',fullBattleDigest:serverDigest.hash,browsers:4,unitsPerReplica:20,tick:90,authorities:results.map(r=>r.authoritative),pageErrors:errors}));
}finally{await browser.close();await server.close();}
