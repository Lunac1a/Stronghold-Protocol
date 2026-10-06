import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canPlace,placeClass} from '../../server/match/board.js';
import {makeMatch,DATA} from './harness.js';
import {createBattleFromSpec,resultDigest} from '../../server/sim/spec.js';
import {DataSource} from '../../server/sim/simdata.js';
const recruits=['chess_custom_6_wang_a','chess_custom_5_chen3_a','chess_custom_5_kalts2_a','chess_custom_6_oblvns_a','chess_custom_5_wisdel_a'];
for(const elite of [false,true])test(`Four-player match preserves selected custom skills through server takeover and reconnect (${elite?'elite':'normal'})`,()=>{
 const h=makeMatch({mode:'coop',humans:4,clientCombat:true,clients:false,seed:781,captureFrames:false}).start(),m=h.m;
 try{
 h.toPrep(1);h.setStage('act2autochess_m04');
 for(const ps of m.players.values()){
  for(const p of ps.board.values())ps.returnCopies(p);ps.board.clear();
  recruits.forEach((id,i)=>{const piece=ps.newPiece('chess',elite?id.replace(/_a$/,'_b'):id);const key=[...ps.deployMap().keys()].find(k=>{const [r,c]=k.split(',').map(Number);return !ps.board.has(k)&&canPlace(ps.deployMap(),placeClass(ps,DATA.chess[piece.id]),r,c);});assert.ok(key);ps.board.set(key,piece);});ps.resolveTemp();
  assert.equal(m.handle(ps.playerId,{t:'g.ready',ready:true}).ok,true);
 }
 assert.ok(h.run(()=>m.phase==='COMBAT'));
 for(const ps of m.players.values()){
  const start=h.lastTo(ps.playerId,'b.start');assert.ok(start?.spec);const field=m.fields.find(f=>f.battleId===start.battleId);assert.ok(field);
  for(const [i,id]of recruits.entries()){const unit=start.spec.players.flatMap(p=>p.units).find(u=>u.chessId===(elite?id.replace(/_a$/,'_b'):id));assert.ok(unit);assert.equal(unit.skillIndex,i===2?1:2);}
  m.onDisconnect(ps.playerId);assert.equal(field.mode,'server');assert.ok(field.result);
  const honest=createBattleFromSpec(field.spec,new DataSource(DATA,null),{quiet:true});const result=honest.runToEnd(4000);assert.equal(honest.errors.length,0);assert.equal(resultDigest(result).hash,resultDigest(field.result).hash);
  m.onReconnect(ps.playerId);const resumed=h.lastTo(ps.playerId,'b.start');assert.equal(resumed.battleId,start.battleId);assert.equal(resumed.authoritative,false);assert.deepEqual(resumed.spec.players,start.spec.players);
 }
 }finally{m.dispose();}
});
for(const [i,id]of recruits.entries())test(`Shared pool purchase, three-copy merge and elite sale preserve copies for ${id}`,()=>{
 let h;for(let seed=1;seed<=100;seed++){const candidate=makeMatch({mode:'coop',humans:2,seed});if(candidate.m.pool.has(id)){h=candidate.start();break;}candidate.m.dispose();}assert.ok(h,'find a match where the operator bond is enabled');const m=h.m;
 try{
 h.toPrep(1);const a=h.ps('p_0'),b=h.ps('p_1');
 for(const ps of [a,b]){for(const p of [...ps.board.values(),...ps.hand.filter(Boolean)])if(p.kind==='chess')ps.returnCopies(p);ps.board.clear();ps.hand.fill(null);ps.temp.fill(null);ps.recompute();ps.funds=100;}
 assert.ok(m.pool.has(id));const cap=m.pool.cap(id);assert.equal(cap,DATA.chess[id].tier===6?5:8);
 const buy=ps=>{ps.shop.slots[0]={kind:'chess',id,basePrice:m.gd.chessPrice(id),frozen:false,sold:false};const before=ps.funds;assert.equal(m.handle(ps.playerId,{t:'g.buy',slot:0}).ok,true);assert.equal(before-ps.funds,m.gd.chessPrice(id));};
 buy(b);assert.equal(m.pool.left(id),cap-1);buy(a);buy(a);buy(a);
 const elite=a.hand.find(p=>p?.id===DATA.chess[id].goldenId);assert.ok(elite);assert.equal(elite.poolCopies,3);assert.equal(a.stats.merges,1);assert.equal(m.pool.left(id),cap-4);
 assert.equal(a.loadoutFor(DATA.chess[elite.id]).skillIndex,i===2?1:2);
 assert.equal(m.handle(a.playerId,{t:'g.sell',uid:elite.uid}).ok,true);assert.equal(m.pool.left(id),cap-1);
 const remaining=b.hand.find(p=>p?.id===id);assert.ok(remaining);assert.equal(m.handle(b.playerId,{t:'g.sell',uid:remaining.uid}).ok,true);assert.equal(m.pool.left(id),cap);
 }finally{m.dispose();}
});
