import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeMatch,DATA} from './harness.js';
import {buildBattleSpec,createBattleFromSpec} from '../../server/sim/spec.js';
import {DataSource} from '../../server/sim/simdata.js';
import {validateC2S} from '../../shared/protocol.js';
import {COLS} from '../../server/sim/constants.js';
function fixture(){
 const h=makeMatch({humans:2,clientCombat:true,clients:false});
 const spec=buildBattleSpec({battleId:'manual',fieldId:'f:p_0',seed:417,stageId:'act2autochess_m04',timeLimit:5,
  players:[{playerId:'p_0',dir:'RIGHT',units:[{uid:100,chessId:'chess_custom_6_wang_a',row:10,col:5,skillIndex:0}]}],
  routes:[{start:[10,7],end:[10,7],motion:'WALK',checkpoints:[{type:'WAIT',time:100}]}],spawns:[{enemyKey:'enemy_1007_slime',count:1,time:3,route:0}]});
 const f={spec,battleId:'manual',fieldId:'f:p_0',kind:'normal',mode:'client',authority:'p_0',players:['p_0'],startAt:h.sched.now(),done:false,cc:true};h.m.fields=[f];
 const msg={t:'b.action',battleId:'manual',seq:0,tick:3,action:{kind:'wang.place',uid:100,row:12,col:4}};return {h,f,msg};
}
test('Server validates manual placement, publishes its replay log, and retries are idempotent',()=>{
 const {h,f,msg}=fixture();assert.equal(validateC2S(msg),null);assert.equal(h.m.handle('p_0',msg).ok,true);
 assert.equal(f.spec.customActions.length,1);assert.equal(f.spec.customActions[0].requestSeq,0);
 assert.equal(h.m.handle('p_0',msg).ok,true);assert.equal(f.spec.customActions.length,1);
 assert.ok(h.allTo('p_0','b.start').every(m=>m.spec.customActions.length===1));
 const replay=createBattleFromSpec(f.spec,new DataSource(DATA,null),{quiet:true});
 while(replay.tickCount<f.actionBattle.tickCount)replay.step();assert.deepEqual(replay.snapshot(),f.actionBattle.snapshot());
 assert.ok(h.m.handle('p_0',{...msg,action:{...msg.action,col:3}}).error);
 h.m.dispose();
});
test('Server rejects foreign, occupied, future and malformed inputs without adding replay commands',()=>{
 const {h,f,msg}=fixture();assert.ok(h.m.handle('p_1',msg).error);
 assert.ok(h.m.handle('p_0',{...msg,tick:31}).error);
 assert.ok(h.m.handle('p_0',{...msg,action:{...msg.action,row:10,col:5}}).error);
 assert.equal(f.spec.customActions,undefined);assert.equal(f.actionBattle,null);
 assert.equal(h.m.handle('p_0',msg).ok,true,'a refused input must not poison the next replay');
 assert.notEqual(validateC2S({...msg,action:{...msg.action,row:-1}}),null);h.m.dispose();
});
test('Server confirms a Kaltsit friend move and preserves its target in takeover replay',()=>{
 const {h,f,msg}=fixture();f.spec=buildBattleSpec({battleId:'manual',fieldId:'f:p_0',seed:417,stageId:'act2autochess_m04',timeLimit:10,flags:{startOpCooldown:0},
 players:[{playerId:'p_0',dir:'RIGHT',units:[{uid:100,chessId:'chess_custom_5_kalts2_a',row:10,col:5,skillIndex:2,carryState:{sp:999}},
 {uid:101,chessId:'chess_char_1_01_a',row:10,col:7},{uid:103,chessId:'chess_char_1_01_a',row:11,col:6,carryState:{hpPct:0.01}},
 {uid:102,kind:'token',tokenId:'token_10068_kalts2_mtship',ownerUid:100,row:10,col:8}]}],
 routes:[{start:[10,6],end:[10,6],motion:'WALK',checkpoints:[{type:'WAIT',time:100}]}],spawns:[{enemyKey:'enemy_1007_slime',count:1,time:0,route:0},{enemyKey:'enemy_1007_slime',count:1,time:9,route:0}]});
 h.sched.advance(1700);const action={...msg,tick:100,action:{kind:'kalts.move',uid:100,targetUid:101,row:12,col:8}};
 assert.equal(validateC2S(action),null);assert.notEqual(validateC2S({...action,action:{...action.action,targetUid:null}}),null);
 const result=h.m.handle('p_0',action);assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(f.spec.customActions[0].action.targetUid,101);assert.equal(h.m.handle('p_0',action).ok,true);assert.equal(f.spec.customActions.length,1);
 const replay=createBattleFromSpec(f.spec,new DataSource(DATA,null),{quiet:true});while(replay.tickCount<f.actionBattle.tickCount)replay.step();
 assert.deepEqual(replay.snapshot(),f.actionBattle.snapshot());assert.equal(replay.allyUnits.find(u=>u.uid===100).mem.kaltsMoveCharges,1);h.m.dispose();
});
test('Server validates a live anchor on an original elevated platform and replays the flight',()=>{
 const {h,f,msg}=fixture();f.spec=buildBattleSpec({battleId:'manual',fieldId:'f:p_0',stageId:'act1autochess_m03',seed:417,timeLimit:20,flags:{startOpCooldown:0},
 players:[{playerId:'p_0',dir:'RIGHT',units:[{uid:100,chessId:'chess_custom_5_kalts2_a',row:10,col:5,skillIndex:2,carryState:{sp:999}},
 {uid:101,chessId:'chess_char_1_01_a',row:11,col:6,carryState:{hpPct:0.01}}]}],spawns:[{enemyKey:'enemy_1007_slime',time:19,count:1,route:0}]});
 const probe=createBattleFromSpec(f.spec,new DataSource(DATA,null),{quiet:true});for(let i=0;i<100;i++)probe.step();
 const u=probe.allyUnits.find(t=>t.uid===100);assert.equal(u.mem.kaltsAnchorAvailable,true);
 const k=[...(probe._elevated||[])].find(k=>!u.rangeKeys.includes(k)&&probe.grid.canStand(Math.floor(k/COLS),k%COLS,{ranged:true})&&!probe.isReservedTile(Math.floor(k/COLS),k%COLS));assert.ok(k!=null);
 h.sched.advance(1700);const command={...msg,tick:100,action:{kind:'kalts.anchor',uid:100,row:Math.floor(k/COLS),col:k%COLS}};
 assert.equal(validateC2S(command),null);const result=h.m.handle('p_0',command);assert.equal(result.ok,true,JSON.stringify(result));
 const replay=createBattleFromSpec(f.spec,new DataSource(DATA,null),{quiet:true});while(replay.tickCount<f.actionBattle.tickCount)replay.step();
 assert.deepEqual(replay.snapshot(),f.actionBattle.snapshot());assert.ok(replay.allyUnits.find(t=>t.uid===100).mem.kaltsTravel);
 assert.equal(h.m.handle('p_0',command).ok,true);assert.equal(f.spec.customActions.length,1);h.m.dispose();
});
test('Both unite participants can place their own Wang pieces; authority, replicas and spectators receive the same log',()=>{
 const {h,f,msg}=fixture();f.kind='unite';f.spec.kind='unite';f.players=['p_0','p_1'];
 f.spec.players.push({playerId:'p_1',dir:'RIGHT',units:[{uid:200,chessId:'chess_custom_6_wang_a',row:12,col:6,skillIndex:0}]});
 f.spectatorSpec={...f.spec,customActions:[]};
 assert.ok(h.m.handle('p_1',{...msg,action:{...msg.action,uid:100}}).error,'no control over another participant');
 const second={...msg,action:{kind:'wang.place',uid:200,row:12,col:5}};
 const result=h.m.handle('p_1',second);assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(f.spec.customActions[0].playerId,'p_1');assert.equal(f.spectatorSpec,null);
 assert.equal(h.m._spectatorSpec(f).customActions.length,1);
 assert.equal(h.m.handle('p_0',msg).ok,true);assert.equal(f.spec.customActions.length,2);
 for(const pid of f.players)assert.equal(h.allTo(pid,'b.start').at(-1).spec.customActions.length,2);
 const replay=createBattleFromSpec(f.spec,new DataSource(DATA,null),{quiet:true});while(replay.tickCount<f.actionBattle.tickCount)replay.step();
 assert.deepEqual(replay.snapshot(),f.actionBattle.snapshot());assert.equal(h.m.handle('p_1',second).ok,true);assert.equal(f.spec.customActions.length,2);
 f.players=['p_0'];assert.ok(h.m.handle('p_1',{...second,seq:1}).error,'a bystander cannot act');h.m.dispose();
});
