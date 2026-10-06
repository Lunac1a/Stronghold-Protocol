#!/usr/bin/env node
// Observe ordinary automated matches without injecting cards, money, shop slots or stages.
import assert from 'node:assert/strict';
import {Match} from '../server/match/Match.js';
import {VirtualScheduler} from '../server/match/scheduler.js';
import {attachAudit} from '../server/match/audit.js';
import {getData} from '../server/data.js';
import {canPlace,placeClass} from '../server/match/board.js';
import {CUSTOM_OPERATORS} from './custom-operators.mjs';

const buyCustom=process.env.SP_BUY_CUSTOM==='1';
const data=getData(),count=Number(process.env.SP_SEEDS||(buyCustom?10:3)),first=Number(process.env.SP_SEED||1);
const seen=new Set(),deployed=new Set(),purchased=new Set(),runs=[];
for(let seed=first;seed<first+count;seed++){
 const scheduler=new VirtualScheduler({instantCombat:true});let result=null;
 const log={info(){},debug(){},warn(){},error(){}};
 const m=new Match({roomCode:'FLOW',mode:'coop',difficulty:'FUNNY',seed,data,log,scheduler,botRehearsal:0,
  seats:Array.from({length:4},(_,seat)=>({seat,playerId:`p_${seat}`,name:`Player ${seat}`,isBot:!buyCustom,connected:true})),
  send:()=>true,broadcast(){},onEnd:r=>{result=r;}});
 const audit=attachAudit(m,{invariants:true}),phases=new Set(),rounds=new Set(),controlled=new Set();
 try{
  if(buyCustom)for(const ps of m.players.values())ps.autoplay=true;
  m.start();scheduler.runUntil(()=>{
   phases.add(m.phase);rounds.add(m.round);
   if(buyCustom&&m.phase==='SP_DRAFT'&&controlled.has(m.spTurn())){
    const idx=m.sp.cards.find(c=>m.sp.taken[c.idx]==null)?.idx;
    if(idx!=null)m.handle(m.spTurn(),{t:'g.choice',idx});
   }
   for(const ps of m.players.values()){
    for(const slot of ps.shop.slots)if(slot?.id?.startsWith('chess_custom_'))seen.add(slot.id);
    if(buyCustom&&m.phase==='PREP'&&!ps.ready&&ps.alive){
     for(const [slotIndex,slot] of ps.shop.slots.entries())if(!slot?.sold&&slot?.id?.startsWith('chess_custom_')){
      if(m.handle(ps.playerId,{t:'g.buy',slot:slotIndex}).ok){purchased.add(slot.id);controlled.add(ps.playerId);ps.autoplay=false;}
     }
     for(const piece of [...ps.hand,...ps.temp].filter(p=>p?.kind==='chess'&&p.id.startsWith('chess_custom_'))){
      const placement=placeClass(ps,data.chess[piece.id]);
      let placed=false;
      for(const key of ps.deployMap().keys()){
       const [row,col]=key.split(',').map(Number);
       if(ps.board.has(key)||!canPlace(ps.deployMap(),placement,row,col))continue;
       if(m.handle(ps.playerId,{t:'g.move',uid:piece.uid,to:{area:'board',row,col}}).ok){placed=true;break;}
      }
      if(!placed)for(const [key,old] of ps.board){
       const [row,col]=key.split(',').map(Number);
       if(old.kind!=='chess'||old.id.startsWith('chess_custom_')||!canPlace(ps.deployMap(),placement,row,col))continue;
       if(!m.handle(ps.playerId,{t:'g.sell',uid:old.uid}).ok)continue;
       assert.equal(m.handle(ps.playerId,{t:'g.move',uid:piece.uid,to:{area:'board',row,col}}).ok,true);
       break;
      }
     }
     if(controlled.has(ps.playerId)){
      while(ps.shop.level<6&&m.handle(ps.playerId,{t:'g.levelUp'}).ok){ /* Pay the normal upgrade price. */ }
      for(const piece of ps.temp.filter(Boolean))m.handle(ps.playerId,{t:'g.sell',uid:piece.uid});
      assert.equal(m.handle(ps.playerId,{t:'g.ready',ready:true}).ok,true);
     }
    }
   }
   for(const field of m.fields)for(const player of field.spec?.players||[])for(const unit of player.units||[])if(unit.chessId?.startsWith('chess_custom_')){
    assert.equal(unit.skillIndex,unit.chessId.includes('kalts2')?1:2);deployed.add(unit.chessId);
   }
   return result!==null;
  },{maxSteps:5e6});
  assert.ok(result,`seed ${seed} did not finish (${m.phase})`);
  assert.deepEqual(audit.violations,[],`seed ${seed}: match rule violations`);
  assert.equal(m.errorCount,0);assert.equal(m.simErrors,0);assert.equal(m.dispatcher.errors,0);
  const run={seed,rounds:[...rounds],phases:[...phases],victory:result.victory,reason:result.reason};runs.push(run);
  console.log(JSON.stringify(run));
 }finally{m.dispose();}
}
if(buyCustom)for(const op of CUSTOM_OPERATORS){
 const id=`chess_custom_${op.tier}_${op.key}_a`;
 assert.ok(purchased.has(id),`${id} never purchased from a natural shop; try more seeds`);
 assert.ok(deployed.has(id),`${id} never reached an actual battle spec; try more seeds`);
}
console.log(JSON.stringify({pass:true,runs:runs.length,customShopOffers:[...seen],customDeployed:[...deployed],
 customPurchased:[...purchased],buyCustom,
 scope:'Unmodified game rules; optional policy buys naturally offered custom cards through validated player actions.'}));
