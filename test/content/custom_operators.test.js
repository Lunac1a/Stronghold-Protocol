import {resolveHit,effectiveProfile} from '../../server/sim/ai.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeBattle,enemyRec,chessRec,checkInvariants} from '../helpers/battleHarness.js';
import {applyCustomAction} from '../../server/sim/customActions.js';
import {COLS} from '../../server/sim/constants.js';
import {unitStatsEntry} from '../../shared/protocol.js';
import {loadoutOptions,checkLoadout} from '../../shared/protocol.js';
import {getDefaultSource} from '../../server/sim/simdata.js';
import {absoluteRangeKeys} from '../../server/sim/targeting.js';
const ids=['chess_custom_6_wang_a','chess_custom_5_chen3_a','chess_custom_5_kalts2_a','chess_custom_6_oblvns_a','chess_custom_5_wisdel_a'];
test('Focused release exposes only S3 for four recruits and S2 for Esperanta in normal and elite loadouts',()=>{
 const ds=getDefaultSource(),get=id=>ds.raw.chess?.[id];
 for(const [i,id]of ids.entries()){
  const base=get(id),elite=get(id.replace(/_a$/,'_b')),index=i===2?1:2;
  assert.ok(base&&elite);assert.deepEqual(loadoutOptions(base,elite).skills,[index]);assert.equal(loadoutOptions(base,elite).defaultSkill,index);
  assert.equal(ds.getChess(id).skill.id,base.skills.find(s=>s.index===index).skillId);
  assert.ok(!/主动关闭|手动停止|随时停止/.test(base.skill.desc),'selected skill does not advertise manual stopping');
  for(const other of [0,1,2].filter(s=>s!==index))assert.equal(checkLoadout({[id]:{skill:other}},get).error,'BAD_TARGET');
 }
});
for(const upper of [false,true])test(`Custom random effects respect ${upper?'upper':'lower'} integer bounds`,()=>{
 const chen=scenario(ids[1],0),c=chen.unit(ids[1]),calls=[];
 const stub=(...args)=>{assert.equal(args.length,1);assert.ok(args[0]>0);calls.push(args[0]);return upper?args[0]-1:0;};
 chen.b.rng.int=stub;c.hp=1;chen.run(12);
 const heals=chen.heals.filter(e=>e.target===c);assert.ok(heals.length>0);
 assert.ok(calls.some(n=>n>3),'healing samples its entire percentage interval');
 assert.ok(Math.abs(heals[0].amount/c.s.atk-(upper?1.65:0.35))<1e-9,'unmodified talent heals between 35% and 165% in 1% steps');
 const saki=scenario(ids[3],0),s=saki.unit(ids[3]);saki.b.rng.int=stub;s.mem.oblvns.notes.length=0;
 assert.ok(saki.runUntil(()=>s.mem.oblvns.notes.length>0,4));
 const note=s.mem.oblvns.notes[0],angle=Math.atan2(s.fwd[1]*note.axisY-s.fwd[0]*note.axisX,s.fwd[1]*note.axisX+s.fwd[0]*note.axisY)*180/Math.PI;
 assert.ok(Math.abs(angle-(upper?20:-20))<1e-6);
 const wis=scenario(ids[4],2),w=wis.unit(ids[4]);wis.run(1.1);wis.b.rng.int=stub;
 const soul=wis.b.allyUnits.find(t=>t.ownerUnit===w&&t.defId==='token_10035_wisdel_wward');
 soul.skill.gainSp(5,'test');wis.run(0.2);
 assert.ok(Math.abs(soul.skill.sp-(upper?2:0))<0.3);assert.ok(calls.includes(3));
});
function scenario(id,index,extra={}){
 const damage=[],heals=[];
 const h=makeBattle({seed:417,timeLimit:100,autoFinish:false,defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})},chess:{patient:chessRec({id:'patient',skill:null,stats:{maxHp:1e8,atk:0}})}},
 units:[{chessId:id,row:10,col:5,uid:'caster',skillIndex:index},{chessId:'patient',row:11,col:6},...(extra.units||[])],enemies:[{key:'dummy',pos:[10,id.includes('chen3')?6:7]}],
 setup(b){b.on('damaged',c=>damage.push({amount:c.amount,type:c.type,tags:c.dmg.tags||[],skill:c.dmg.isSkill}));b.on('heal',c=>heals.push(c));}});
 h.run(0.1);h.unit('patient').hp=1e7;h.damage=damage;h.heals=heals;return h;
}
for(const tc of [
 {name:'high defense',def:900,res:0,type:'phys',want:'arts',amount:1000},
 {name:'high resistance',def:0,res:90,type:'arts',want:'phys',amount:1000},
 {name:'physical tie',def:500,res:50,type:'phys',want:'phys',amount:500},
 {name:'arts tie',def:500,res:50,type:'arts',want:'arts',amount:500},
 {name:'both damage floors',def:2000,res:100,type:'arts',want:'arts',amount:50},
 {name:'source defense penetration',def:900,res:50,type:'arts',want:'phys',source:{defIgnorePct:1},amount:1000},
 {name:'hit resistance penetration',def:500,res:90,type:'phys',want:'arts',hit:{resIgnoreFlat:90},amount:1000},
 {name:'excluding physical vulnerability',def:900,res:0,type:'phys',want:'arts',target:{physTakenMul:100},amount:1000},
 {name:'excluding arts damage multiplier',def:0,res:90,type:'arts',want:'phys',source:{artsDealtMul:100},amount:1000},
 {name:'fixed physical weakness',def:900,res:0,type:'arts',want:'phys',flags:{fixedWeaknessPhys:true},amount:100},
 {name:'fixed arts weakness',def:0,res:90,type:'phys',want:'arts',flags:{fixedWeaknessArts:true},amount:100},
])test(`Chen weakness conversion: ${tc.name}`,()=>{
 const h=scenario(ids[1],0),u=h.unit(ids[1]),e=h.b.enemies[0],hits=[];
 e.base.def=tc.def;e.base.res=tc.res;e.markDirty();
 if(tc.source)h.b.addBuff(u,{key:'test:source',mods:tc.source});
 if(tc.target||tc.flags)h.b.addBuff(e,{key:'test:target',mods:tc.target,flags:tc.flags});
 h.b.on('hit',ctx=>{if(ctx.source===u&&ctx.target===e)hits.push(ctx.dmg.type);},{priority:-11});
 const dealt=h.b.dealDamage(u,e,{amount:1000,type:tc.type,canDodge:false,...tc.hit});
 assert.deepEqual(hits,[tc.want]);assert.ok(Math.abs(dealt-tc.amount)<1e-7);checkInvariants(h.b);
});
for(const moduleId of ['none','uniequip_002_chen3'])for(const upper of [false,true])test(`Chen elite ${moduleId} talent heals at 7 seconds with the ${upper?'165% upper':'35% lower'} bound`,()=>{
 const heals=[],h=makeBattle({autoFinish:false,units:[{chessId:'chess_custom_5_chen3_b',uid:'chen',row:10,col:5,skillIndex:0,moduleId}],
  setup(b){b.on('heal',ctx=>heals.push({time:b.time,...ctx}));}}),u=h.unit('chen');
 h.run(0.1);u.hp=1;h.b.rng.int=n=>upper?n-1:0;h.run(6.8);assert.equal(heals.length,0);
 h.run(0.3);assert.equal(heals.length,1);assert.ok(heals[0].time>=7&&heals[0].time<7.2);
 assert.ok(Math.abs(heals[0].amount/u.s.atk-(upper?1.65:0.35))<1e-9);
 checkInvariants(h.b);
});
for(const hadEvade of [false,true])test(`Chen S2 movement ${hadEvade?'preserves':'does not invent'} the one-shot talent evasion`,()=>{
 const h=scenario(ids[1],1),u=h.unit(ids[1]),e=h.b.enemies[0];
 h.b.addBuff(e,{key:'test:stop-attacks',flags:{noAttack:true}});
 if(hadEvade)h.b.addBuff(u,{key:'chen3:evade',flags:{chenEvade:true}});
 const seq=u.deploySeq;u.skill.activate('test',{free:true});assert.ok(h.runUntil(()=>u.deploySeq!==seq,6));
 assert.deepEqual([u.tileR,u.tileC],[10,6]);assert.equal(!!u.findBuff('chen3:evade'),hadEvade);
 assert.equal(u.skill.sp,0);assert.ok(u.findBuff('chen3:afterDash'));checkInvariants(h.b);
});
test('Chen talent evasion runs at -1000 and only consumes a charge for physical or arts attacks',()=>{
 const h=scenario(ids[1],0),u=h.unit(ids[1]),e=h.b.enemies[0],seen=[];
 h.b.on('hit',ctx=>{if(ctx.target===u)seen.push(['before',ctx.dmg.amount]);},{priority:-999});
 h.b.on('hit',ctx=>{if(ctx.target===u)seen.push(['after',ctx.dmg.amount]);},{priority:-1001});
 for(const type of ['phys','arts']){
  h.b.addBuff(u,{key:'chen3:evade',flags:{chenEvade:true}});
  const hp=u.hp;h.b.dealDamage(e,u,{amount:100,type,isAttack:true,canDodge:false});
  assert.equal(u.hp,hp);assert.equal(u.findBuff('chen3:evade'),null);
  assert.deepEqual(seen.splice(0),[['before',100],['after',0]]);
 }
 for(const spec of [{type:'true',isAttack:true},{type:'phys',isAttack:false}]){
  h.b.addBuff(u,{key:'chen3:evade',flags:{chenEvade:true}});
  h.b.dealDamage(e,u,{amount:100,...spec,canDodge:false});assert.ok(u.findBuff('chen3:evade'));
 }
 checkInvariants(h.b);
});
function kaltsMoving(){
 const h=scenario(ids[2],2,{units:[{chessId:'patient',uid:'friend1',row:10,col:9},{chessId:'patient',uid:'friend2',row:11,col:9}]}),u=h.unit(ids[2]);
 h.b.spawnToken(u,'token_10068_kalts2_mtship',10,8,{anySource:true});u.skill.activate('test',{free:true});
 assert.ok(h.runUntil(()=>!u.mem.kaltsTravel,3));return {h,u};
}
test('Esperanta heal selection respects bans except the original Mon3tr summon',()=>{
 const h=scenario(ids[2],0),u=h.unit(ids[2]),patient=h.unit('patient');
 h.b.addBuff(patient,{key:'test:ban',flags:{noHeal:true,healFree:true}});
 assert.ok(!h.b.injuredAlliesInKeys(u.rangeKeys,u).includes(patient));
 patient.defId='char_4179_monstr';assert.ok(!h.b.injuredAlliesInKeys(u.rangeKeys,u).includes(patient));
 patient.defId='token_10002_kalts_mon3tr';assert.ok(h.b.injuredAlliesInKeys(u.rangeKeys,u).includes(patient));
 const before=patient.hp;assert.ok(h.b.heal(u,patient,100)>0);assert.equal(patient.hp,before+100);
 h.b.addBuff(patient,{key:'test:isolation',flags:{isolated:true,noHeal:true}});
 assert.ok(!h.b.injuredAlliesInKeys(u.rangeKeys,u).includes(patient));assert.equal(h.b.heal(u,patient,100),0);checkInvariants(h.b);
});
test('Esperanta entry talent applies immediately on deployment and keeps only one shield layer',()=>{
 const h=scenario(ids[2],0),u=h.unit(ids[2]),a=h.unit('patient');
 assert.equal(a.findBuff('kalts2:shield').shieldHits,1);const hp=a.hp;
 h.b.dealDamage(null,a,{amount:100,type:'true'});assert.equal(a.hp,hp);assert.ok(!a.findBuff('kalts2:shield')?.shieldHits);
 h.run(0.1);assert.ok(!a.findBuff('kalts2:shield')?.shieldHits,'remaining in range does not refill the shield');
 assert.ok(h.b.moveRedeploy(a,a.tileR,a.tileC));assert.equal(a.findBuff('kalts2:shield').shieldHits,1,'a new deployment applies immediately');
 assert.ok(h.b.moveRedeploy(a,a.tileR,a.tileC));assert.equal(a.findBuff('kalts2:shield').shieldHits,1);checkInvariants(h.b);
});
test('Esperanta entry talent ignores isolation and covers an allied participant; medical splash also crosses owners',()=>{
 const h=scenario(ids[2],1),u=h.unit(ids[2]),a=h.unit('patient');a.ownerId='teammate';
 h.b.removeBuff(a,'kalts2:shield');h.b.removeBuff(a,'kalts2:recovery');
 h.b.addBuff(a,{key:'test:isolation',flags:{isolated:true,noHeal:true}});
 assert.ok(h.b.moveRedeploy(a,a.tileR,a.tileC));assert.equal(a.findBuff('kalts2:shield').shieldHits,1);assert.ok(a.findBuff('kalts2:recovery'));
 h.b.removeBuff(a,'test:isolation');u.skill.activate('test',{free:true});a.hp=1;u.skill.spec.attack.onHit({battle:h.b,unit:u,target:h.b.enemies[0]});
 assert.ok(a.hp>1,'medical splash heals the other participant');checkInvariants(h.b);
});
test('Esperanta entry recovery is doubled only for Rhodes, refreshes without stacking, and expires after thirty seconds',()=>{
 const h=scenario(ids[2],0),u=h.unit(ids[2]),a=h.unit('patient');h.b.addBuff(u,{key:'test:noAttack',flags:{disarm:true}});
 const base=a.s.hpRegen;assert.ok(base>0);assert.equal(a.findBuff('kalts2:recovery').stacks,1);
 a.def={...a.def,raw:{nationId:'rhodes'}};h.b.moveRedeploy(a,a.tileR,a.tileC);assert.equal(a.s.hpRegen,base*2);
 h.b.moveRedeploy(a,a.tileR,a.tileC);assert.equal(a.s.hpRegen,base*2);assert.equal(a.findBuff('kalts2:recovery').stacks,1);
 h.run(30.1);assert.ok(!a.findBuff('kalts2:recovery'));assert.equal(a.s.hpRegen,0);checkInvariants(h.b);
});
test('Esperanta range exit and re-entry replenish the consumed shield, while remaining inside does not',()=>{
 const h=scenario(ids[2],0),u=h.unit(ids[2]),a=h.unit('patient');h.b.dealDamage(null,a,{amount:100,type:'true'});
 assert.ok(h.b.relocate(a,9,3));h.run(0.05);assert.ok(h.b.relocate(a,11,6));h.run(0.05);
 assert.equal(a.findBuff('kalts2:shield').shieldHits,1);checkInvariants(h.b);
});
test('Esperanta medical splash restores a banned nearby ally without selecting it as the primary target',()=>{
 const h=scenario(ids[2],1),u=h.unit(ids[2]),patient=h.unit('patient'),e=h.b.enemies[0];
 h.b.addBuff(patient,{key:'test:ban',flags:{noHeal:true,healFree:true}});
 assert.ok(!h.b.injuredAlliesInKeys(u.rangeKeys,u).includes(patient));
 const before=patient.hp;u.skill.activate('test',{free:true});
 u.skill.spec.attack.onHit({battle:h.b,unit:u,target:e});assert.ok(patient.hp>before);checkInvariants(h.b);
});
test('Esperanta can complete healing when the target becomes banned after selection; ordinary healers cannot',()=>{
 const h=scenario(ids[2],0),u=h.unit(ids[2]),patient=h.unit('patient');
 assert.ok(h.b.injuredAlliesInKeys(u.rangeKeys,u).includes(patient));
 h.b.addBuff(patient,{key:'test:ban',flags:{noHeal:true,healFree:true}});
 assert.equal(h.b.heal(patient,patient,100),0);assert.ok(h.b.heal(u,patient,100)>0);checkInvariants(h.b);
});
test('Wang pieces retain the official ALL deployment position on free high ground',()=>{
 const h=makeBattle({autoFinish:false,flat:{rows:{12:'##hrrrrrrrfrrrrrrrf##'}},units:[{chessId:ids[0],uid:'caster',row:10,col:5,skillIndex:0}]}),u=h.unit(ids[0]);h.run(0.1);
 assert.equal(h.b.tokenDef('token_10064_wang_stone1',u).position,'ALL');
 const result=applyCustomAction(h.b,u.ownerId,{kind:'wang.place',uid:u.uid,row:12,col:2});assert.ok(result.ok,JSON.stringify(result));
 const token=h.b.allyUnits.find(t=>t.id===result.unitId);assert.equal(token.ground,false);checkInvariants(h.b);
});
test('Manual Wang placement respects the two-second card cooldown without charging rejected inputs',()=>{
 const h=scenario(ids[0],0),u=h.unit(ids[0]),ps=h.b.getPlayer(u.ownerId),st=u.mem.wang;
 const action={kind:'wang.place',uid:u.uid,row:12,col:4},other={...action,col:3};assert.ok(applyCustomAction(h.b,u.ownerId,action).ok);
 const dp=ps.dp,stock=st.stock;assert.equal(applyCustomAction(h.b,u.ownerId,other).reason,'cooldown');assert.equal(ps.dp,dp);assert.equal(st.stock,stock);
 h.run(1.9);assert.equal(applyCustomAction(h.b,u.ownerId,other).reason,'cooldown');
 h.run(0.1);assert.equal(applyCustomAction(h.b,u.ownerId,other).ok,true);assert.equal(st.stock,stock-1);checkInvariants(h.b);
});
for(const [form,moduleId,limit,cost]of [['a',undefined,6,3],['b','none',6,3],['b','uniequip_002_wang',7,2]])test(`Wang ${form}/${moduleId||'normal'} enforces the selected ${limit}-piece limit and ${cost} DP cost`,()=>{
 const id=ids[0].replace(/_a$/,`_${form}`),h=makeBattle({autoFinish:false,flat:{rows:{11:'##rrrrrrrrrrrrrrrrr##'}},units:[{chessId:id,uid:'caster',row:10,col:5,skillIndex:0,moduleId}]}),u=h.unit(id);h.run(0.1);
 const def=h.b.tokenDef('token_10064_wang_stone1',u);assert.equal(def.deployLimit,limit);assert.equal(def.stats.cost,cost);
 for(const [r,c]of [[12,2],[12,3],[12,4],[12,5],[10,2],[10,3]])assert.ok(h.b.spawnToken(u,'token_10064_wang_stone1',r,c));
 u.mem.wang.stock=1;const ps=h.b.getPlayer(u.ownerId),dp=ps.dp,action={kind:'wang.place',uid:u.uid,row:11,col:2};
 const result=applyCustomAction(h.b,u.ownerId,action);
 if(limit===6){assert.equal(result.reason,'limit');assert.equal(ps.dp,dp);assert.equal(u.mem.wang.stock,1);}
 else{assert.ok(result.ok,JSON.stringify(result));assert.equal(ps.dp,dp-cost);u.mem.wang.stock=1;assert.equal(applyCustomAction(h.b,u.ownerId,{...action,col:3}).reason,'limit');}
 checkInvariants(h.b);
});
test('Wang S3 permits an enemy-occupied low floor inside its range, but never a high tile or ally slot',()=>{
 const row='##rrrrfrrrfrrrrrrrf##',h=makeBattle({autoFinish:false,flat:{rows:{10:row}},defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}},
 units:[{chessId:ids[0],uid:'caster',row:10,col:5,skillIndex:2}],enemies:[{key:'dummy',pos:[10,6]}]}),u=h.unit(ids[0]);h.run(0.1);
 const action={kind:'wang.place',uid:u.uid,row:10,col:6};assert.equal(applyCustomAction(h.b,u.ownerId,action).reason,'tile');
 u.skill.activate('test',{free:true});assert.equal(applyCustomAction(h.b,u.ownerId,{...action,col:5}).reason,'tile');
 const result=applyCustomAction(h.b,u.ownerId,action);assert.ok(result.ok,JSON.stringify(result));
 assert.equal(applyCustomAction(h.b,u.ownerId,{...action,row:0,col:0}).reason,'tile');checkInvariants(h.b);
});
test('A live tactical anchor accepts only a ranged tile outside Kaltsit range and consumes one skill grant',()=>{
 const row='##hrrrrrrrfrrrrrrrf##',h=makeBattle({autoFinish:false,flat:{rows:{12:row}},units:[{chessId:ids[2],uid:'caster',row:10,col:5,skillIndex:2}]}),u=h.unit(ids[2]);h.run(0.1);
 const action={kind:'kalts.anchor',uid:u.uid,row:12,col:2},ps=h.b.getPlayer(u.ownerId);
 assert.equal(applyCustomAction(h.b,u.ownerId,action).ok,false);u.skill.activate('test',{free:true});
 assert.equal(applyCustomAction(h.b,u.ownerId,{...action,row:10,col:3}).reason,'tile');
 const dp=ps.dp,cost=h.b.tokenDef('token_10068_kalts2_mtship',u).stats.cost;
 const result=applyCustomAction(h.b,u.ownerId,action);assert.ok(result.ok,JSON.stringify(result));
 assert.equal(ps.dp,dp-cost);assert.ok(u.mem.kaltsTravel);assert.equal(u.mem.kaltsAnchorAvailable,false);
 assert.equal(applyCustomAction(h.b,u.ownerId,action).ok,false);h.run(2);assert.deepEqual([u.tileR,u.tileC],[12,2]);
 assert.equal(u.mem.kaltsMoveCharges,2);u.skill.stop();assert.equal(u.mem.kaltsAnchorAvailable,false);checkInvariants(h.b);
});
function kaltsDestination(h,u,a){return u.rangeKeys.map(k=>[Math.floor(k/COLS),k%COLS]).find(([r,c])=>h.b.grid.canStand(r,c,{ranged:a.def.position!=='MELEE'})&&!h.b.isReservedTile(r,c));}
test('Kaltsit leaves eligible friends in place until two distinct manual moves are confirmed',()=>{
 const {h,u}=kaltsMoving(),friends=['friend1','friend2'].map(uid=>h.b.allyUnits.find(a=>a.uid===uid));
 assert.equal(u.mem.kaltsMoveCharges,2);assert.deepEqual(friends.map(a=>[a.tileR,a.tileC]),[[10,9],[11,9]]);
 const ps=h.b.getPlayer(u.ownerId),dp=ps.dp;
 for(const a of friends){
  const p=kaltsDestination(h,u,a);assert.ok(p);const action={kind:'kalts.move',uid:u.uid,targetUid:a.uid,row:p[0],col:p[1]};
  const result=applyCustomAction(h.b,u.ownerId,action);assert.equal(result.ok,true,JSON.stringify({result,eligible:[...u.mem.kaltsMoveEligible],id:a.id,seq:a.deploySeq,p}));assert.deepEqual([a.tileR,a.tileC],p);
  assert.equal(applyCustomAction(h.b,u.ownerId,action).ok,false,'one friend cannot spend both moves');
 }
 assert.equal(u.mem.kaltsMoveCharges,0);assert.equal(ps.dp,dp);checkInvariants(h.b);
});
test('Kaltsit rejects foreign, occupied and out-of-range destinations without spending moves; skill stop expires them',()=>{
 const {h,u}=kaltsMoving(),action={kind:'kalts.move',uid:u.uid,targetUid:'friend1',row:10,col:8};
 assert.equal(applyCustomAction(h.b,'other',action).ok,false);
 assert.equal(applyCustomAction(h.b,u.ownerId,action).reason,'tile');
 assert.equal(applyCustomAction(h.b,u.ownerId,{...action,row:0,col:0}).reason,'tile');
 assert.equal(applyCustomAction(h.b,u.ownerId,{...action,targetUid:u.uid}).reason,'target');
 assert.equal(u.mem.kaltsMoveCharges,2);u.skill.stop();assert.equal(u.mem.kaltsMoveCharges,0);assert.equal(u.mem.kaltsMoveEligible.size,0);
 assert.equal(applyCustomAction(h.b,u.ownerId,action).reason,'action');checkInvariants(h.b);
});
for(const retreat of [false,true])test(`Chen S1 clears only its own silence on ${retreat?'retreat':'skill stop'}`,()=>{
 const h=scenario(ids[1],0),u=h.unit(ids[1]),e=h.enemy();u.skill.activate('test',{free:true});
 assert.ok(h.runUntil(()=>!!e.findBuff(`chen3:silence:${u.id}`),4));
 h.b.applyStatus(e,'silence',{duration:30,source:h.unit('patient')});
 if(retreat)h.b.retreat(u,{permanent:true});else u.skill.stop();
 assert.ok(!e.findBuff(`chen3:silence:${u.id}`));assert.ok(e.s.flags.silence);assert.ok(e.findBuff('silence'));
 h.b.removeBuff(e,'silence');assert.ok(!e.s.flags.silence);checkInvariants(h.b);
});
for(const id of ids.flatMap(id=>[id,id.replace(/_a$/,'_b')]))for(let index=0;index<3;index++)test(`${id} skill ${index+1}: specific combat path and clean simulation`,()=>{
 const extra=id.includes('wang')?{units:[{kind:'token',tokenId:'token_10064_wang_stone1',row:10,col:6,ownerUid:'caster'}]}:{};
 const h=scenario(id,index,extra),u=h.unit(id);
 assert.equal(u.skill.noSkill,false);
 assert.equal(u.def.skill.index,index);
 assert.ok(u.skill.activate('test',{free:true}));h.run(8);
 assert.ok(u.skill.activations>=1);
 if(id.includes('kalts2')){
  assert.ok(u.s.flags.liftoff&&u.s.flags.blockFly);
  if(index===1)assert.ok(h.damage.some(d=>d.tags.includes('kalts2:medical')&&d.type==='true'));
  else assert.ok(h.heals.length>0,'injured ally is healed');
 }else if(id.includes('wang')){
  assert.ok(u.mem.wang.stock>=0&&u.mem.wang.stock<=u.mem.wang.maxStock);
  assert.ok(h.damage.some(d=>d.tags.some(t=>t.startsWith('wang:'))),'connected piece damages entrant');
 }else if(id.includes('chen3')){
  if(index===1)assert.ok(h.damage.some(d=>d.tags.includes('chen3:slash')));
  if(index===2)assert.ok(h.damage.some(d=>d.tags.includes('chen3:wave')));
  assert.ok(h.damage.length>0);
 }else if(id.includes('wisdel'))assert.ok(h.damage.some(d=>d.tags.includes('aftershock')));
 else assert.ok(h.damage.some(d=>d.tags.includes('oblvns:note')));
 checkInvariants(h.b);
});
test('custom battle is deterministic with identical seed and loadout',()=>{
 const a=scenario(ids[4],2),b=scenario(ids[4],2);a.run(45);b.run(45);
 assert.deepEqual(a.damage,b.damage);assert.deepEqual(a.snapshot(),b.snapshot());
});
test('Wang S3 overflow prioritizes an enemy on unbuildable ground before an enemy on buildable ground',()=>{
 const h=makeBattle({autoFinish:false,flat:{rows:{10:'##rrrrfrrrfrrrrrrrf##'}},defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}},
 units:[{chessId:ids[0],uid:'caster',row:10,col:5,skillIndex:2}],enemies:[{key:'dummy',pos:[10,7]},{key:'dummy',pos:[10,6]}]});
 h.run(0.1);const u=h.unit('caster'),st=u.mem.wang,ps=h.b.getPlayer(u.ownerId),dp=ps.dp;st.stock=1;
 u.skill.activate('test',{free:true});assert.equal(st.nodes.length,1);assert.deepEqual([st.nodes[0].r,st.nodes[0].c],[10,6]);
 assert.equal(st.nodes[0].token,null);assert.equal(st.stock,st.maxStock);assert.equal(u.skill.ammoLeft,20);assert.equal(ps.dp,dp);checkInvariants(h.b);
});
test('Wang S3 never spends inventory automatically after its opening overflow placement',()=>{
 const h=scenario(ids[0],2),u=h.unit(ids[0]),st=u.mem.wang;st.stock=0;u.skill.activate('test',{free:true});
 for(const n of st.nodes)n.active=false;
 const stock=st.stock,ammo=u.skill.ammoLeft;h.run(0.5);
 assert.equal(st.stock,stock);assert.equal(u.skill.ammoLeft,ammo);assert.equal(st.nodes.length,0);checkInvariants(h.b);
});
test('Wang S3 manual placement creates one free follower and up to three timed extra followers and pays ammunition only for successful followers',()=>{
 const h=scenario(ids[0],2),u=h.unit(ids[0]),st=u.mem.wang;st.stock=0;u.skill.activate('test',{free:true});st.nodes=[];
 const ps=h.b.getPlayer(u.ownerId);ps.dp=h.b.flags.dpMax;const dp=ps.dp,stock=st.stock,ammo=u.skill.ammoLeft;
 const result=applyCustomAction(h.b,u.ownerId,{kind:'wang.place',uid:u.uid,row:10,col:7});assert.ok(result.ok,JSON.stringify(result));
 assert.equal(st.nodes.filter(n=>!n.token).length,1);assert.equal(u.skill.ammoLeft,ammo);for(const e of h.b.enemies)h.b.kill(e);h.run(1);const followers=st.nodes.filter(n=>!n.token);assert.equal(followers.length,4);assert.equal(u.skill.ammoLeft,ammo-3);
 assert.equal(st.stock,stock-1);assert.ok(Math.abs(ps.dp-(dp-h.b.tokenDef('token_10064_wang_stone1',u).stats.cost+h.b.flags.dpPerSec))<1e-6);checkInvariants(h.b);
});
test('Protocol Wang automatically ends S3 at zero inventory and refunds remaining ammunition',()=>{
 const h=scenario(ids[0],2),u=h.unit(ids[0]);u.mem.wang.stock=0;u.skill.activate('test',{free:true});u.mem.wang.stock=0;u.skill.ammoLeft=4;h.run(0.1);assert.equal(u.skill.active,false);assert.equal(u.mem.wang.stock,4);
});
test('Protocol Wang placing the last inventory piece automatically ends S3 even while pieces remain on the field',()=>{
 const h=scenario(ids[0],2),u=h.unit(ids[0]),st=u.mem.wang;st.stock=0;u.skill.activate('test',{free:true});
 st.nodes=[];st.stock=1;u.skill.ammoLeft=7;h.b.getPlayer(u.ownerId).dp=20;
 const result=applyCustomAction(h.b,u.ownerId,{kind:'wang.place',uid:u.uid,row:12,col:4});assert.ok(result.ok);
 assert.equal(st.stock,0);assert.equal(u.skill.ammoLeft,7);assert.ok(st.nodes.some(n=>n.active));
 h.run(0.1);assert.equal(u.skill.active,false);assert.equal(st.stock,7);checkInvariants(h.b);
});
test('Protocol Wisdel S2 automatically enters overload and ends after both timed phases',()=>{
 const h=scenario(ids[4],1),u=h.unit(ids[4]);u.skill.activate('test',{free:true});
 h.run(u.skill.duration/2-0.1);assert.equal(u.mem.wisOverload,false);assert.equal(u.skill.active,true);
 h.run(0.2);assert.equal(u.mem.wisOverload,true);assert.equal(u.skill.active,true);
 h.run(u.skill.duration/2+0.1);assert.equal(u.skill.active,false);assert.equal(u.mem.wisOverload,false);checkInvariants(h.b);
});
test('Protocol Wisdel S3 waits without targets and only ends after all six bullets are fired',()=>{
 const h=scenario(ids[4],2),u=h.unit(ids[4]),used=[];
 for(const e of h.b.enemies)h.b.kill(e);u.skill.activate('test',{free:true});
 h.b.on('ammoUsed',ctx=>{if(ctx.unit===u)used.push(ctx.left);});
 h.run(40);assert.equal(u.skill.active,true);assert.equal(u.skill.ammoLeft,6);assert.deepEqual(used,[]);
 h.spawn('dummy',{pos:[10,7]});assert.ok(h.runUntil(()=>!u.skill.active,60));
 assert.deepEqual(used,[5,4,3,2,1,0]);assert.equal(u.skill.ammoLeft,0);checkInvariants(h.b);
});
test('Wang S3 exhausted ammunition preserves the free talent follower and stops paid extra followers',()=>{
 const h=scenario(ids[0],2),u=h.unit(ids[0]),st=u.mem.wang,ps=h.b.getPlayer(u.ownerId);
 for(const e of h.b.enemies)h.b.kill(e);st.stock=0;u.skill.activate('test',{free:true});st.nodes=[];u.skill.ammoLeft=1;ps.dp=h.b.flags.dpMax;
 assert.ok(applyCustomAction(h.b,u.ownerId,{kind:'wang.place',uid:u.uid,row:10,col:7}).ok);assert.equal(u.skill.ammoLeft,1);h.run(.9);
 assert.equal(u.skill.ammoLeft,0);assert.equal(st.nodes.filter(n=>!n.token).length,2);assert.equal(u.skill.active,true);
 st.stock=0;h.run(.1);assert.equal(u.skill.active,false);assert.equal(st.stock,0);checkInvariants(h.b);
});

test('Sakiko free notes disappear after the caster dies',()=>{
 const h=scenario(ids[3],0),u=h.unit(ids[3]);assert.ok(h.runUntil(()=>u.mem.oblvns.notes.length>0,5));h.b.retreat(u,{permanent:true});assert.equal(u.mem.oblvns.notes.length,0);h.run(2);checkInvariants(h.b);
});
test('Sakiko tracking notes survive permanent retreat and deal cached damage',()=>{
 const h=scenario(ids[3],0),u=h.unit(ids[3]);
 assert.ok(h.runUntil(()=>u.mem.oblvns.notes.some(n=>n.state==='tracking'),5));
 const note=u.mem.oblvns.notes.find(n=>n.state==='tracking'),cached=note.atk;
 h.b.retreat(u,{permanent:true});
 assert.ok(u.mem.oblvns.notes.includes(note));
 assert.ok(u.mem.oblvns.notes.every(n=>n.state==='tracking'));
 const before=h.damage.length;
 h.run(3);
 assert.ok(h.damage.slice(before).some(d=>d.tags.includes('oblvns:note')));
 assert.equal(note.atk,cached);
 assert.equal(u.mem.oblvns.notes.length,0);
 checkInvariants(h.b);
});
test('Sakiko tracking notes terminate when the target dies after retreat',()=>{
 const h=scenario(ids[3],0),u=h.unit(ids[3]);
 assert.ok(h.runUntil(()=>u.mem.oblvns.notes.some(n=>n.state==='tracking'),5));
 h.b.retreat(u,{permanent:true});h.b.kill(h.enemy(),u);h.run(1);
 assert.equal(u.mem.oblvns.notes.length,0);checkInvariants(h.b);
});
test('Kaltsit anchor travel moves at 3.5 tiles/s and pauses S3 countdown',()=>{
 const h=scenario(ids[2],2),u=h.unit(ids[2]);
 const anchor=h.b.spawnToken(u,'token_10068_kalts2_mtship',10,10,{anySource:true});
 assert.ok(anchor);assert.ok(u.skill.activate('test',{free:true}));
 const duration=u.skill.timeLeft;
 assert.equal(u.x,5,'does not teleport on activation');
 h.run(0.5);
 assert.ok(u.x>6.5&&u.x<7.1,`travel x=${u.x}`);
 assert.ok(u.s.flags.invulnerable&&u.s.flags.noBlock&&u.s.flags.disarm);
 assert.ok(Math.abs(u.skill.timeLeft-duration)<0.1);
 assert.ok(h.unit('patient').findBuff('kalts2:recovery'),'path grants the entry talent');
 h.run(2);
 assert.equal(u.tileC,10);assert.equal(u.x,10);
 assert.equal(u.mem.kaltsTravel,null);assert.ok(!u.findBuff('kalts2:travel'));
 assert.ok(u.skill.timeLeft<duration);checkInvariants(h.b);
});
test('Kaltsit interrupted anchor travel restores tile position and clears travel flags',()=>{
 const h=scenario(ids[2],2),u=h.unit(ids[2]);
 h.b.spawnToken(u,'token_10068_kalts2_mtship',10,10,{anySource:true});
 u.skill.activate('test',{free:true});h.run(0.5);u.skill.stop();
 assert.equal(u.x,u.tileC);assert.equal(u.y,u.tileR);
 assert.equal(u.mem.kaltsTravel,null);assert.ok(!u.findBuff('kalts2:travel'));
 checkInvariants(h.b);
});
test('Kaltsit path talent recognizes a new deployment without refilling shields every flight frame',()=>{
 const h=scenario(ids[2],2,{units:[{chessId:'patient',uid:'pathFriend',row:12,col:8}]}),u=h.unit(ids[2]),a=h.unit('pathFriend');
 assert.ok(!u.rangeKeys.includes(a.tileR*COLS+a.tileC),'friend is outside the stationary entry aura');
 h.b.spawnToken(u,'token_10068_kalts2_mtship',10,10,{anySource:true});u.skill.activate('test',{free:true});
 assert.ok(h.runUntil(()=>!!a.findBuff('kalts2:shield')?.shieldHits,2));assert.ok(u.mem.kaltsTravel);
 h.b.dealDamage(null,a,{amount:100,type:'true'});assert.ok(!a.findBuff('kalts2:shield')?.shieldHits);
 h.run(0.1);assert.ok(!a.findBuff('kalts2:shield')?.shieldHits,'remaining in the collision area does not refill');
 assert.ok(h.b.moveRedeploy(a,a.tileR,a.tileC));h.run(0.05);
 assert.equal(a.findBuff('kalts2:shield')?.shieldHits,1,'a new deployment is a new entry');
 h.run(0.1);assert.equal(a.findBuff('kalts2:shield')?.shieldHits,1);checkInvariants(h.b);
});
test('Wisdel talent waits for the full deployment animation before summoning a soul',()=>{
 const h=scenario(ids[4],0),u=h.unit(ids[4]);
 const souls=()=>h.b.allyUnits.filter(t=>t.ownerUnit===u&&t.defId==='token_10035_wisdel_wward'&&t.alive);
 h.run(0.8);assert.equal(souls().length,0);h.run(0.2);assert.equal(souls().length,1);checkInvariants(h.b);
});
test('Wisdel deployment summon is cancelled when the operator retreats before animation completion',()=>{
 const h=scenario(ids[4],0),u=h.unit(ids[4]);h.run(0.3);h.b.retreat(u,{permanent:true});h.run(1.1);
 assert.equal(h.b.allyUnits.filter(t=>t.ownerUnit===u&&t.defId==='token_10035_wisdel_wward').length,0);checkInvariants(h.b);
});
test('Wisdel redeployment does not inherit the old deployment summon timer',()=>{
 const h=scenario(ids[4],0),u=h.unit(ids[4]);h.run(0.3);h.b.retreat(u,{permanent:true});
 assert.ok(h.b._deploy(u));h.run(0.7);
 assert.equal(h.b.allyUnits.filter(t=>t.ownerUnit===u&&t.defId==='token_10035_wisdel_wward'&&t.alive).length,0);
 h.run(0.4);assert.equal(h.b.allyUnits.filter(t=>t.ownerUnit===u&&t.defId==='token_10035_wisdel_wward'&&t.alive).length,1);checkInvariants(h.b);
});
test('Wisdel S3 creates exactly two new souls with initial SP three then zero',()=>{
 const h=scenario(ids[4],2),u=h.unit(ids[4]);h.run(1.1);
 for(const t of h.b.allyUnits)if(t.ownerUnit===u&&t.defId==='token_10035_wisdel_wward'&&t.alive)h.b.retreat(t,{permanent:true});
 u.skill.activate('test',{free:true});const souls=h.b.allyUnits.filter(t=>t.ownerUnit===u&&t.defId==='token_10035_wisdel_wward'&&t.alive);
 assert.equal(souls.length,2);assert.deepEqual(souls.map(t=>t.skill.spTotal),[3,0]);checkInvariants(h.b);
});
test('Soul camouflage is granted at deployment and cannot appear later after isolation expires',()=>{
 const h=scenario(ids[4],2),u=h.unit(ids[4]);h.run(1.1);
 for(const t of h.b.allyUnits)if(t.ownerUnit===u&&t.defId==='token_10035_wisdel_wward'&&t.alive)h.b.retreat(t,{permanent:true});
 h.b.removeBuff(u,'wisdel:camo');h.b.addBuff(u,{key:'test:isolation',flags:{isolated:true}});
 const t=h.b.spawnToken(u,'token_10035_wisdel_wward',10,6);assert.ok(t);assert.equal(t.mem.wisCamoGranted,false);
 h.b.removeBuff(u,'test:isolation');h.run(0.4);assert.ok(!u.s.flags.camou);
 h.b.retreat(t,{permanent:true});const next=h.b.spawnToken(u,'token_10035_wisdel_wward',10,6);assert.ok(next.mem.wisCamoGranted);h.run(0.3);assert.equal(u.s.flags.camou,true);checkInvariants(h.b);
});
test('Soul placement resolves equal distance by lower map row then left column',()=>{
 const h=scenario(ids[4],2),u=h.unit(ids[4]);h.run(1.1);
 for(const t of h.b.allyUnits)if(t.ownerUnit===u&&t.defId==='token_10035_wisdel_wward'&&t.alive)h.b.retreat(t,{permanent:true});
 u.rangeKeys=[11*COLS+5,9*COLS+5,10*COLS+4,10*COLS+6];u.rangeKeySet=new Set(u.rangeKeys);u.skill.activate('test',{free:true});
 const souls=h.b.allyUnits.filter(t=>t.ownerUnit===u&&t.defId==='token_10035_wisdel_wward'&&t.alive);
 assert.deepEqual(souls.map(t=>[t.tileR,t.tileC]),[[9,5],[10,4]]);checkInvariants(h.b);
});
test('Wisdel residual marks belong to their caster and disappear only when that caster retreats',()=>{
 const h=scenario(ids[4],0,{units:[{chessId:ids[4],uid:'second',row:12,col:4,skillIndex:0}]}),u=h.unit(ids[4]),other=h.unit('second'),e=h.b.enemies[0];
 u.profile.onEachHit(h.b,u,e,{kind:'main'});other.profile.onEachHit(h.b,other,e,{kind:'main'});
 assert.equal(e.mem[`wisdel:${u.id}`],true);assert.equal(e.mem[`wisdel:${other.id}`],true);
 h.b.retreat(u,{permanent:true});assert.equal(e.mem[`wisdel:${u.id}`],undefined);assert.equal(e.mem[`wisdel:${other.id}`],true);checkInvariants(h.b);
});
test('Wisdel aftershock includes the main-target talent multiplier without boosting splash victims',()=>{
 const h=scenario(ids[4],1),u=h.unit(ids[4]),e=h.b.enemies[0],splash=h.spawn('dummy',{pos:[10,7]}),hits=[];
 h.b.addBuff(u,{key:'test:noAttack',flags:{disarm:true}});h.b.rng.chance=()=>false;
 h.b.on('damaged',ctx=>{if(ctx.source===u&&ctx.dmg.tags?.includes('aftershock'))hits.push([ctx.target,ctx.amount]);});
 const atk=u.s.atk,mainScale=u.def.raw.talents[0].bb['attack@main_atk_scale'];
 u.profile.afterHit(h.b,u,e,{x:e.x,y:e.y,isSkill:false});h.run(0.4);
 assert.ok(Math.abs(hits.find(([t])=>t===e)[1]-atk*0.5*mainScale)<1e-7);
 assert.ok(Math.abs(hits.find(([t])=>t===splash)[1]-atk*0.5)<1e-7);checkInvariants(h.b);
});
test('Wisdel S2 starts in its three-target state after stopping an overloaded activation',()=>{
 const h=scenario(ids[4],1),u=h.unit(ids[4]);u.skill.activate('test',{free:true});h.run(u.skill.duration/2+0.2);assert.equal(u.mem.wisOverload,true);
 u.skill.stop();u.skill.activate('test',{free:true});assert.equal(u.mem.wisOverload,false);assert.equal(u.skill.spec.targeting.maxTargets,3);assert.equal(u.skill.spec.attack.atkScale,1);checkInvariants(h.b);
});
test('Soul shadow uses real SP, accepts external SP and obeys SP recovery lock',()=>{
 const h=scenario(ids[4],2),u=h.unit(ids[4]);h.run(1.1);
 const soul=h.b.allyUnits.find(t=>t.ownerUnit===u&&t.defId==='token_10035_wisdel_wward');
 assert.ok(soul);assert.equal(soul.skill.spCost,5);assert.equal(soul.skill.initSp,0);
 assert.ok(!h.damage.some(d=>d.tags.includes('wisdel:soul')));
 soul.skill.gainSp(5,'test');h.run(0.2);
 assert.ok(h.damage.some(d=>d.tags.includes('wisdel:soul')),'external SP enables the attack before 5 seconds');
 assert.ok(soul.skill.sp<3,'refund is between 0 and 2 plus elapsed recovery');
 h.b.addBuff(soul,{key:'test:spLock',flags:{noSp:true}});
 const count=h.damage.filter(d=>d.tags.includes('wisdel:soul')).length;
 h.run(6);
 assert.equal(h.damage.filter(d=>d.tags.includes('wisdel:soul')).length,count);
 assert.equal(h.b.errors.length,0);checkInvariants(h.b);
});
test('Wang records talent layers at activation, including simultaneous connected pieces',()=>{
 const h=scenario(ids[0],0),u=h.unit(ids[0]),st=u.mem.wang;
 const nodes=[{r:12,c:2,active:true,token:null},{r:12,c:3,active:true,token:null}];
 st.nodes=nodes;h.run(0.2);
 assert.equal(nodes[0].activation.layers,2);assert.equal(nodes[1].activation.layers,2);
 const third={r:12,c:4,active:true,token:null};st.nodes.push(third);h.run(0.2);
 assert.equal(third.activation.layers,3);assert.equal(nodes[0].activation.layers,2);
 nodes[1].active=false;third.active=false;h.spawn('dummy',{pos:[12,2]});h.run(1);
 assert.ok(h.damage.some(d=>d.tags.includes('wang:dot')),'an activated piece survives loss of its connecting neighbours');
 checkInvariants(h.b);
});
test('Sakiko piano hits only after tracking, then pierces for half a second without repeat damage',()=>{
 const h=scenario(ids[3],1),u=h.unit(ids[3]),st=u.mem.oblvns,e=h.b.enemies[0];st.notes=[];
 u.profile.customAttack(h.b,u);h.b.addBuff(u,{key:'test:noAttack',flags:{disarm:true}});
 const n=st.notes[0];assert.equal(n.speed,1.9);assert.equal(n.trackingSpeed,3.5);
 n.x=e.x;n.y=e.y;n.originX=e.x;n.originY=e.y;n.axisX=1;n.axisY=0;n.sine=false;n.vx=1;n.vy=0;n.nextUpdate=100;
 h.run(1/30);assert.equal(e.hp,e.maxHp,'free notes cannot hit incidental enemies');
 n.state='tracking';n.target=e;n.x=e.x-0.2;h.run(1/30);assert.equal(n.state,'hit');const hp=e.hp;
 const second=h.spawn('dummy',{pos:[10,8]});h.run(0.4);assert.ok(second.hp<second.maxHp);assert.equal(e.hp,hp);
 assert.ok(st.notes.includes(n));h.run(0.2);assert.ok(!st.notes.includes(n));checkInvariants(h.b);
});
test('Sakiko organ and S3 use their own free and tracking speeds; S3 starts with defense priorities',()=>{
 const h=scenario(ids[3],1),u=h.unit(ids[3]);u.mem.oblvns.organ=true;u.mem.oblvns.notes=[];u.profile.customAttack(h.b,u);
 const organ=u.mem.oblvns.notes[0];assert.equal(organ.speed,0.7);assert.equal(organ.trackingSpeed,1);assert.equal(organ.turn,1/12);
 const s=scenario(ids[3],2),a=s.unit(ids[3]),res=s.b.enemies[0],def=s.spawn('dummy',{pos:[10,8]});
 s.b.addBuff(res,{key:'test:res',mods:{resFlat:50}});s.b.addBuff(def,{key:'test:def',mods:{defFlat:1000}});a.skill.activate('test',{free:true});s.run(1/30);
 a.mem.oblvns.notes=[];a.profile.customAttack(s.b,a);assert.equal(a.mem.oblvns.notes.length,4);
 for(const n of a.mem.oblvns.notes){assert.equal(n.speed,0.8);assert.equal(n.trackingSpeed,1.3);assert.equal(n.minFree,0.8);assert.equal(n.target,n.type==='phys'?res:def);}
 checkInvariants(h.b);checkInvariants(s.b);
});
test('Sakiko resumes a free sine curve at its current position after losing a tracking target',()=>{
 const h=scenario(ids[3],1),u=h.unit(ids[3]);u.mem.oblvns.notes=[];u.profile.customAttack(h.b,u);h.b.addBuff(u,{key:'test:noAttack',flags:{disarm:true}});
 const n=u.mem.oblvns.notes[0];n.state='tracking';n.x=8;n.y=10;n.vx=1;n.vy=0;n.age=10;n.nextUpdate=10;
 for(const e of h.b.enemies)h.b.kill(e);h.run(1/30);
 assert.equal(n.state,'free');assert.ok(Math.abs(n.x-8)<0.1);assert.ok(Math.abs(n.y-10)<0.1);assert.equal(n.originX,8);checkInvariants(h.b);
});
test('Kaltsit S2 automatically starts for an injured friend when no enemies remain',()=>{
 const h=scenario(ids[2],1),u=h.unit(ids[2]);for(const e of h.b.enemies)h.b.kill(e);
 u.skill.setSpTotal(u.skill.spCost);h.run(0.1);assert.equal(u.skill.active,true);
 const ammo=u.skill.ammoLeft;h.run(4);assert.ok(u.skill.ammoLeft<ammo);assert.ok(h.heals.some(e=>e.source===u));checkInvariants(h.b);
});
for(const friendly of [false,true])test(`Kaltsit medical impact on ${friendly?'friend':'enemy'} respects ordering and slow rules`,()=>{
 const h=scenario(ids[2],1),u=h.unit(ids[2]),e=h.b.enemies[0],a=h.unit('patient'),order=[];
 e.x=a.x;e.y=a.y;
 h.b.on('damaged',ctx=>{if(ctx.dmg.tags?.includes('kalts2:medical')){order.push('damage');assert.equal(ctx.dmg.isSkill,false);}});
 h.b.on('heal',ctx=>{if(ctx.source===u)order.push('heal');});
 u.skill.spec.attack.onHit({battle:h.b,unit:u,target:friendly?a:e});
 assert.equal(order[0],friendly?'heal':'damage');assert.ok(order.includes('heal'));assert.ok(order.includes('damage'));
 assert.equal(!!e.findBuff('sluggish'),!friendly);checkInvariants(h.b);
});
test('Kaltsit medical targeting prefers taunt and then its own blocked enemy',()=>{
 const h=scenario(ids[2],1),u=h.unit(ids[2]),ordinary=h.b.enemies[0],taunted=h.spawn('dummy',{pos:[10,6]});
 h.b.addBuff(taunted,{key:'test:taunt',mods:{taunt:10}});u.skill.activate('test',{free:true});h.run(1/30);h.b.releaseBlocked(u);
 const choose=()=>{const ctx={attacker:u,targets:[]};h.b.emit('beforeAttack',ctx);return ctx.targets[0];};
 assert.equal(choose(),taunted);
 ordinary.blockedBy=u;u.blocking.push(ordinary);assert.equal(choose(),ordinary);checkInvariants(h.b);
});
for(const form of ['a','b'])test(`Kaltsit S2 ${form} actual ten attacks consume ten bullets and end automatically`,()=>{
 const id=ids[2].replace(/_a$/,`_${form}`),h=scenario(id,1),u=h.unit(id),used=[];
 h.b.on('ammoUsed',ctx=>{if(ctx.unit===u)used.push(ctx.left);});u.skill.activate('test',{free:true});
 assert.equal(u.skill.ammoLeft,10);assert.ok(h.runUntil(()=>!u.skill.active,60));
 assert.deepEqual(used,[9,8,7,6,5,4,3,2,1,0]);assert.equal(u.skill.ammoLeft,0);
 h.b.addBuff(u,{key:'test:stop-attacks',flags:{disarm:true}});h.run(1);
 const impacts=h.damage.filter(d=>d.tags.includes('kalts2:medical'));assert.equal(impacts.length,10);
 assert.ok(impacts.every(d=>Math.abs(d.amount-impacts[0].amount)<1e-7),'the last projectile retains the same skill ATK as the other nine');checkInvariants(h.b);
});
for(const friendly of [false,true])test(`Kaltsit medical projectile ${friendly?'does not heal a redeployed friend':'fizzles when the enemy dies'} and never spends a second bullet on impact`,()=>{
 const h=scenario(ids[2],1),u=h.unit(ids[2]),target=friendly?h.unit('patient'):h.b.enemies[0];
 if(friendly)for(const e of h.b.enemies)h.b.kill(e);
 h.heals.length=0;h.damage.length=0;u.skill.activate('test',{free:true});
 assert.ok(h.runUntil(()=>h.b.projectiles.list.some(p=>p.source===u&&p.target===target),4));
 assert.equal(u.skill.ammoLeft,9);assert.ok(!h.heals.some(c=>c.source===u),'healing waits for impact');
 h.b.addBuff(u,{key:'test:no-followup',flags:{disarm:true}});
 if(friendly)assert.ok(h.b.moveRedeploy(target,target.tileR,target.tileC));else h.b.kill(target);
 h.heals.length=0;h.damage.length=0;h.run(0.5);
 assert.equal(u.skill.ammoLeft,9);assert.ok(!h.b.projectiles.list.some(p=>p.source===u));
 assert.ok(!h.heals.some(c=>c.source===u));assert.ok(!h.damage.some(c=>c.tags.includes('kalts2:medical')));checkInvariants(h.b);
});
test('Kaltsit medical projectile retains launched damage after its source retreats',()=>{
 const h=scenario(ids[2],1),u=h.unit(ids[2]);u.skill.activate('test',{free:true});const attack=u.s.atk;
 assert.ok(h.runUntil(()=>h.b.projectiles.list.some(p=>p.source===u),4));h.b.retreat(u,{permanent:true});h.damage.length=0;
 h.run(0.5);const hit=h.damage.find(c=>c.tags.includes('kalts2:medical'));assert.ok(hit);assert.ok(Math.abs(hit.amount-attack*3.1)<1e-7);checkInvariants(h.b);
});
for(const [form,atkBonus,damageScale,healScale] of [['a',1.1,3.1,1.35],['b',1.25,3.5,1.7]])test(`Kaltsit S2 ${form} medical damage and healing match trained skill values at splash boundaries`,()=>{
 const id=ids[2].replace(/_a$/,`_${form}`),h=scenario(id,1),u=h.unit(id),e=h.b.enemies[0],a=h.unit('patient'),base=u.s.atk;
 e.x=6;e.y=11;a.x=7.49;a.y=11;
 const inside=h.spawn('dummy',{pos:[11,7.49]}),outside=h.spawn('dummy',{pos:[11,7.51]});
 inside.base.def=1e6;inside.base.res=100;inside.markDirty();
 u.skill.activate('test',{free:true});assert.ok(Math.abs(u.s.atk-base*(1+atkBonus))<1e-7);
 const before=inside.hp,untouched=outside.hp;h.damage.length=0;h.heals.length=0;
 u.skill.spec.attack.onHit({battle:h.b,unit:u,target:e});
 assert.ok(Math.abs(before-inside.hp-u.s.atk*damageScale)<1e-6,'true damage ignores DEF and RES');
 assert.equal(outside.hp,untouched);assert.ok(h.damage.every(d=>d.type==='true'&&!d.skill));
 const heal=h.heals.find(c=>c.target===a);assert.ok(heal);assert.ok(Math.abs(heal.amount-u.s.atk*healScale)<1e-7);
 a.x=7.51;h.heals.length=0;u.skill.spec.attack.onHit({battle:h.b,unit:u,target:e});assert.ok(!h.heals.some(c=>c.target===a));checkInvariants(h.b);
});
test('Wang S2 latches both axes as neighbours change and retains them after removal',()=>{
 const h=scenario(ids[0],1),u=h.unit(ids[0]),st=u.mem.wang;
 const center={r:12,c:3,active:true,token:null},right={r:12,c:4,active:true,token:null};st.nodes=[center,right];h.run(0.2);
 assert.equal(center.activation.horizontal,true);assert.equal(center.activation.vertical,false);
 const above={r:13,c:3,active:true,token:null};st.nodes.push(above);h.run(0.2);
 assert.equal(center.activation.vertical,true);right.active=false;above.active=false;
 const horizontal=h.spawn('dummy',{pos:[12,5]}),vertical=h.spawn('dummy',{pos:[14,3]});h.spawn('dummy',{pos:[12,3]});h.run(0.2);
 assert.ok(horizontal.hp<horizontal.maxHp);assert.ok(vertical.hp<vertical.maxHp);assert.equal(center.active,false);checkInvariants(h.b);
});
for(const index of [0,1])test(`Wang skill ${index+1} responds to aerial enemies`,()=>{
 const h=scenario(ids[0],index),u=h.unit(ids[0]);u.mem.wang.nodes=[{r:12,c:3,active:true,token:null},{r:12,c:4,active:true,token:null}];h.run(0.2);
 const e=h.spawn('dummy',{pos:[12,3]});h.b.addBuff(e,{key:'test:air',flags:{levitate:true}});assert.equal(e.isFlying,true);h.run(0.7);
 assert.ok(e.hp<e.maxHp);checkInvariants(h.b);
});
test('Wang S2 slow layers multiply and expire independently',()=>{
 const h=scenario(ids[0],1),u=h.unit(ids[0]),st=u.mem.wang;
 const e=h.spawn('dummy',{pos:[12,3]});
 e.base.moveSpeed=2;e.markDirty();h.b.addBuff(e,{key:'test:stationary',flags:{noMove:true}});
 const trigger=()=>{st.nodes=[{r:12,c:3,active:true,token:null},{r:12,c:4,active:true,token:null}];h.run(0.2);};
 trigger();const first=e.buffs.find(x=>x.key==='wang:slow');assert.ok(first);const mul=first.mods.moveMul;
 h.run(1);trigger();const layers=e.buffs.filter(x=>x.key==='wang:slow');assert.equal(layers.length,2);
 assert.ok(Math.abs(e.s.moveSpeed-2*mul*mul)<1e-9);assert.ok(layers[0].timeLeft<layers[1].timeLeft);
 h.run(layers[0].timeLeft+0.1);assert.equal(e.buffs.filter(x=>x.key==='wang:slow').length,1);
 assert.ok(Math.abs(e.s.moveSpeed-2*mul)<1e-9);
 h.run(2);assert.equal(e.buffs.filter(x=>x.key==='wang:slow').length,0);assert.equal(e.s.moveSpeed,2);checkInvariants(h.b);
});
test('Wang S1 periodic damage is sourceless, credited to Wang and keeps its cached attack after retreat',()=>{
 const h=scenario(ids[0],0),u=h.unit(ids[0]),e=h.spawn('dummy',{pos:[12,3]}),dots=[];
 h.b.on('damaged',ctx=>{if(ctx.dmg.tags?.includes('wang:dot'))dots.push(ctx);});
 u.mem.wang.nodes=[{r:12,c:3,active:true,token:null},{r:12,c:4,active:true,token:null}];h.run(0.8);assert.ok(dots.length);
 const amount=dots[0].amount;assert.equal(dots[0].source,null);assert.equal(dots[0].credit,u);
 h.b.addBuff(u,{key:'test:lateAttack',mods:{atkPct:10}});h.b.retreat(u,{permanent:true});h.run(1.1);
 assert.ok(dots.length>=3);assert.ok(dots.every(d=>d.source===null&&d.credit===u&&Math.abs(d.amount-amount)<1e-7));checkInvariants(h.b);
});
test('Wang independent slow layers stop at speed 0.1 and never override immobilization',()=>{
 const h=scenario(ids[0],1),u=h.unit(ids[0]),st=u.mem.wang,e=h.spawn('dummy',{pos:[12,3]});
 e.base.moveSpeed=2;e.markDirty();h.b.addBuff(e,{key:'test:stationary',flags:{noMove:true}});
 for(let i=0;i<12;i++){st.nodes=[{r:12,c:3,active:true,token:null},{r:12,c:4,active:true,token:null}];h.run(0.2);}
 assert.equal(e.buffs.filter(x=>x.key==='wang:slow').length,12);assert.equal(e.s.moveSpeed,0.1);
 h.b.applyStatus(e,'bind',{duration:1,source:u});assert.equal(e.s.moveSpeed,0);h.run(1.1);assert.equal(e.s.moveSpeed,0.1);
 for(const buff of [...e.buffs])if(buff.key==='wang:slow')h.b.removeBuff(e,buff);assert.equal(e.s.moveSpeed,2);checkInvariants(h.b);
});
test('Wang pieces allow airborne occupants and automatically redeploy on the selected tile when stock and DP recover',()=>{
 const h=scenario(ids[0],0),u=h.unit(ids[0]),st=u.mem.wang,e=h.spawn('dummy',{pos:[12,3]});h.b.addBuff(e,{key:'test:air',flags:{levitate:true}});
 const result=applyCustomAction(h.b,u.ownerId,{kind:'wang.place',uid:u.uid,row:12,col:3});assert.ok(result.ok,JSON.stringify(result));
 const token=h.b.allyUnits.find(t=>t.id===result.unitId);h.run(0.2);assert.equal(token.alive,false);assert.equal(token.removed,false);
 const stock=st.stock;h.b.kill(e);h.run(3);assert.equal(token.alive,true);assert.equal(st.stock,stock-1);checkInvariants(h.b);
});
test('Wang full stock stops natural and external SP recovery until stock is consumed',()=>{
 const h=scenario(ids[0],0),u=h.unit(ids[0]),st=u.mem.wang;
 st.stock=st.maxStock;h.run(0.2);const sp=u.skill.spTotal;
 u.skill.gainSp(10,'test');h.run(0.5);assert.equal(u.skill.spTotal,sp);
 st.stock--;h.run(0.2);assert.ok(u.skill.spTotal>sp);checkInvariants(h.b);
});
test('Protocol Wang waits for deployment cost and then automatically reuses the chosen piece tile once',()=>{
 const h=makeBattle({autoFinish:false,flags:{dpPerSec:0},units:[{chessId:ids[0],uid:'wang',row:9,col:5,skillIndex:0},
 {kind:'token',tokenId:'token_10064_wang_stone1',ownerUid:'wang',row:10,col:5}]}),u=h.unit('wang');h.run(0.1);
 const t=h.b.allyUnits.find(t=>t.ownerUnit===u&&t.defId==='token_10064_wang_stone1'),ps=h.b.getPlayer(u.ownerId),st=u.mem.wang;
 h.b.retreat(t,{reason:'expired'});st.stock=2;ps.dp=0;h.run(2.2);assert.equal(t.alive,false);assert.equal(st.stock,2);assert.equal(ps.dp,0);
 ps.dp=t.base.cost;h.run(0.2);assert.equal(t.alive,true);assert.equal(st.stock,1);assert.equal(ps.dp,0);
 h.run(0.3);assert.equal(st.stock,1);assert.equal(ps.dp,0);checkInvariants(h.b);
});
test('Protocol Wang resumes paid deployment after S3 automatically refunds its inventory',()=>{
 const h=makeBattle({autoFinish:false,flags:{dpPerSec:0},units:[{chessId:ids[0],uid:'wang',row:9,col:5,skillIndex:2},
 {kind:'token',tokenId:'token_10064_wang_stone1',ownerUid:'wang',row:10,col:5}]}),u=h.unit('wang');h.run(0.1);
 const t=h.b.allyUnits.find(t=>t.ownerUnit===u&&t.defId==='token_10064_wang_stone1'),ps=h.b.getPlayer(u.ownerId),st=u.mem.wang;
 h.b.retreat(t,{reason:'expired'});st.stock=0;u.skill.activate('test',{free:true});st.stock=0;u.skill.ammoLeft=4;ps.dp=0;h.run(2.2);
 assert.equal(t.alive,false);assert.equal(u.skill.active,false);assert.equal(st.stock,4);ps.dp=t.base.cost;
 h.run(0.2);assert.equal(t.alive,true);assert.equal(st.stock,3);assert.equal(ps.dp,0);checkInvariants(h.b);
});
test('Wang follower placement uses absolute map up before right in every facing',()=>{
 for(const dir of ['UP','RIGHT','DOWN','LEFT']){
  const h=makeBattle({autoFinish:false,units:[{chessId:ids[0],row:9,col:5,dir,uid:'wang',skillIndex:0},
    {kind:'token',tokenId:'token_10064_wang_stone1',row:10,col:5,dir,ownerUid:'wang'}]});
  h.run(0.2);const u=h.unit('wang'),follower=u.mem.wang.nodes.find(n=>!n.token);
  assert.ok(follower,dir);assert.deepEqual([follower.r,follower.c],[11,5],dir);
  checkInvariants(h.b);
 }
});
test('A follower displaced by ally deployment cannot activate its neighbour',()=>{
 const h=scenario(ids[0],0),u=h.unit(ids[0]);
 const n={r:11,c:5,active:true,token:null};
 u.mem.wang.nodes=[n,{r:11,c:6,active:true,token:null}];h.run(0.2);
 assert.equal(u.mem.wang.nodes.length,1);assert.equal(n.activation,undefined);
 checkInvariants(h.b);
});
test('Battle snapshots expose stock and current Fever state without prior events',()=>{
 const w=scenario(ids[0],0),wu=w.unit(ids[0]);
 assert.deepEqual(w.snapshot().gauges.find(g=>g[0]===wu.id),[wu.id,'stock',7,8,0,0]);
 const h=scenario(ids[3],2),u=h.unit(ids[3]);
 const f=h.b.customFever.get(u.ownerId);f.value=450;
 assert.equal(h.snapshot().gauges.find(g=>g[0]===u.id)[2],450);
 u.skill.activate('test',{free:true});const g=h.snapshot().gauges.find(g=>g[0]===u.id);
 assert.equal(g[2],0);assert.equal(g[4],Math.round((h.b.time+20)*100)/100);assert.equal(g[5],20);
});

test('Fever expires and releases saved state after the conductor permanently retreats',()=>{
 const h=scenario(ids[3],2),u=h.unit(ids[3]),f=h.b.customFever.get(u.ownerId);
 f.value=450;u.skill.activate('test',{free:true});assert.ok(f.until>h.b.time);
 f.held.set(u.id,12);h.b.retreat(u,{permanent:true});h.run(21);
 assert.equal(f.until,0);assert.equal(f.held.size,0);checkInvariants(h.b);
});

test('Fever pauses a duration at frame precision and ends a skill begun during Fever',()=>{
 const h=scenario(ids[3],2),u=h.unit(ids[3]),f=h.b.customFever.get(u.ownerId);
 const ended=[];h.b.on('skillEnd',ctx=>{if(ctx.unit===u)ended.push(ctx.reason);});
 f.value=450;u.skill.activate('test',{free:true});const left=u.skill.timeLeft;
 h.run(5);assert.ok(Math.abs(u.skill.timeLeft-left)<0.07);
 h.run(15.1);assert.equal(f.until,0);assert.ok(ended.includes('fever'));checkInvariants(h.b);
});

test('A specified ensemble member can start Fever, which casts other members for free and excludes outsiders and toggles',()=>{
 const h=makeBattle({autoFinish:false,defs:{chess:{
  member:chessRec({id:'member',charId:'char_4183_mortis',skill:{duration:30,spCost:100}}),
  other:chessRec({id:'other',charId:'char_4184_dolris',skill:{duration:30,spCost:100}}),
  toggle:chessRec({id:'toggle',charId:'char_4185_amoris',skill:{duration:30,spCost:100}}),
  outsider:chessRec({id:'outsider',skill:{duration:30,spCost:100}})}},
 units:[{chessId:ids[3],row:10,col:5,skillIndex:2},{chessId:'member',row:11,col:6},{chessId:'other',row:12,col:6},{chessId:'toggle',row:12,col:7},{chessId:'outsider',row:11,col:7}]});
 h.run(0.1);const u=h.unit(ids[3]),member=h.unit('member'),other=h.unit('other'),toggle=h.unit('toggle'),outsider=h.unit('outsider');
 toggle.skill.kind='toggle';outsider.def.raw.teamId='mujica';
 const f=h.b.customFever.get(u.ownerId);f.value=450;const sp=other.skill.spTotal;
 member.skill.activate('test',{free:true});assert.ok(f.until>h.b.time);assert.ok(!f.held.has(member.id));h.run(0.1);
 assert.equal(other.skill.active,true);assert.ok(Math.abs(other.skill.spTotal-sp)<0.2);assert.equal(toggle.skill.activations,0);assert.equal(outsider.skill.activations,0);
 h.b.retreat(u,{permanent:true});h.run(20);assert.equal(f.until,0);assert.equal(other.skill.active,false);assert.equal(member.skill.active,false);checkInvariants(h.b);
});
test('Sakiko extends actual targeting into overlapping member vision without copying extra compound tiles',()=>{
 const h=makeBattle({autoFinish:false,defs:{chess:{member:chessRec({id:'member',charId:'char_4183_mortis',rangeGrid:[[0,0],[0,1],[0,2],[0,3]],skill:null}),
 outsider:chessRec({id:'outsider',rangeGrid:[[0,0],[0,1],[0,2],[0,3]],skill:null})}},
 units:[{chessId:ids[3],uid:'sakiko',row:10,col:5,skillIndex:0},{chessId:'member',row:10,col:7},{chessId:'outsider',row:11,col:7}]});
 h.run(0.1);const u=h.unit('sakiko'),a=h.unit('member');h.b.setExtraRange(a,[12*COLS+12]);h.run(0.3);
 assert.ok(u.rangeKeys.includes(10*COLS+10));assert.ok(!u.rangeKeys.includes(12*COLS+12));assert.ok(!u.rangeKeys.includes(11*COLS+10));
 assert.ok(unitStatsEntry(u,u.s).range.some(([r,c])=>r===0&&c===5),'the detail card includes the copied tile');
 const e=h.spawn('dummy',{pos:[10,10]});h.run(1/30);assert.ok(h.b.enemiesInKeys(u.rangeKeys,u,{canHitFly:true}).includes(e));
 h.b.retreat(a,{permanent:true});h.run(0.3);assert.ok(!u.rangeKeys.includes(10*COLS+10));checkInvariants(h.b);
 assert.ok(!unitStatsEntry(u,u.s).range.some(([r,c])=>r===0&&c===5),'the detail card removes lost vision');
});
test('Sakiko displayed range rotates back to its actual targeting tiles in every facing',()=>{
 for(const dir of ['UP','RIGHT','DOWN','LEFT']){
  const h=scenario(ids[3],0),u=h.unit(ids[3]);u.dir=dir;h.b.refreshRange(u);h.run(0.3);
  const grid=unitStatsEntry(u,u.s).range,keys=absoluteRangeKeys(grid,u.tileR,u.tileC,dir,0);
  assert.deepEqual([...keys].sort((a,b)=>a-b),[...u.rangeKeys].sort((a,b)=>a-b),dir);checkInvariants(h.b);
 }
});
test('Sakiko penetration uses the current note count at each impact without waiting for an aura refresh',()=>{
 const h=scenario(ids[3],0),u=h.unit(ids[3]),e=h.b.enemies[0];h.b.addBuff(e,{key:'test:def',mods:{defFlat:100}});
 const bb=u.def.raw.talents[0].bb;u.mem.oblvns.notes=[];
 const plain=h.b.dealDamage(u,e,{amount:200,type:'phys',canDodge:false});assert.equal(plain,100);
 u.mem.oblvns.notes=[{},{}];const boosted=h.b.dealDamage(u,e,{amount:200,type:'phys',canDodge:false});
 assert.ok(Math.abs(boosted-(100+200*bb.def_penetrate_ratio))<1e-7);
 u.mem.oblvns.notes=[];assert.equal(h.b.dealDamage(u,e,{amount:200,type:'phys',canDodge:false}),100);checkInvariants(h.b);
});
test('Fever progresses on a dodged hit but remains empty while active',()=>{
 const h=scenario(ids[3],0),u=h.unit(ids[3]),e=h.b.enemies[0],f=h.b.customFever.get(u.ownerId);
 h.b.addBuff(e,{key:'test:dodge',mods:{dodgePhys:1}});f.value=0;const hp=e.hp;
 h.b.dealDamage(u,e,{amount:100,type:'phys'});assert.equal(e.hp,hp);assert.equal(f.value,3);
 f.value=450;u.skill.activate('test',{free:true});assert.ok(f.until>h.b.time);h.b.dealDamage(u,e,{amount:100,type:'phys'});assert.equal(f.value,0);checkInvariants(h.b);
});
test('Fever fatal prevention defers to higher-priority protection and retires only members it saved',()=>{
 const h=scenario(ids[3],2),u=h.unit(ids[3]),f=h.b.customFever.get(u.ownerId);f.value=450;u.skill.activate('test',{free:true});
 const protection=h.b.on('fatal',ctx=>{if(ctx.unit===u){ctx.prevented=true;ctx.unit.hp=100;}},{priority:0});
 h.b.dealDamage(h.b.enemies[0],u,{amount:1e7,type:'true'});assert.equal(u.hp,100);assert.ok(!u.mem.oblvnsFatal);
 h.b.off(protection);h.b.dealDamage(h.b.enemies[0],u,{amount:1e7,type:'true'});assert.equal(u.hp,1);assert.equal(u.mem.oblvnsFatal,true);
 h.run(20.1);assert.equal(u.alive,false);assert.equal(u.mem.oblvnsFatal,false);checkInvariants(h.b);
});
test('A saved member who retreats and redeploys does not inherit an old Fever fatal marker',()=>{
 const h=scenario(ids[3],2),u=h.unit(ids[3]),f=h.b.customFever.get(u.ownerId);f.value=450;u.skill.activate('test',{free:true});
 h.b.dealDamage(h.b.enemies[0],u,{amount:1e7,type:'true'});assert.equal(u.mem.oblvnsFatal,true);
 h.b.retreat(u);assert.equal(u.mem.oblvnsFatal,false);assert.ok(h.b.redeploy(u,{free:true}));
 h.run(20.1);assert.equal(u.alive,true);assert.equal(u.mem.oblvnsFatal,false);checkInvariants(h.b);
});
test('Fever restores a previously running member skill even after Sakiko retreats',()=>{
 const h=makeBattle({autoFinish:false,defs:{chess:{member:chessRec({id:'member',charId:'char_4183_mortis',skill:{duration:30}})}},
 units:[{chessId:ids[3],row:10,col:5,skillIndex:2},{chessId:'member',row:11,col:6}]});
 h.run(0.1);const u=h.unit(ids[3]),a=h.unit('member');a.skill.activate('test',{free:true});h.run(2);
 const saved=a.skill.timeLeft,f=h.b.customFever.get(u.ownerId);f.value=450;u.skill.activate('test',{free:true});
 assert.equal(f.held.get(a.id),saved);h.b.retreat(u,{permanent:true});h.run(5);
 assert.ok(Math.abs(a.skill.timeLeft-saved)<0.07);
 h.run(15.1);assert.equal(f.until,0);assert.ok(a.skill.active);
 assert.ok(Math.abs(a.skill.timeLeft-saved)<0.2);checkInvariants(h.b);
});

test('Manual Wang placement pays DP once, consumes one stock and creates the follower',()=>{
 const h=scenario(ids[0],0),u=h.unit(ids[0]),ps=h.b.getPlayer(u.ownerId),st=u.mem.wang;
 const before=st.stock,dp=ps.dp,cost=h.b.tokenDef('token_10064_wang_stone1',u).stats.cost;
 const result=applyCustomAction(h.b,u.ownerId,{kind:'wang.place',uid:u.uid,row:12,col:4});
 assert.ok(result.ok,JSON.stringify(result));assert.equal(st.stock,before-1);assert.equal(ps.dp,dp-cost);
 assert.ok(st.nodes.some(n=>n.token&&n.r===12&&n.c===4));assert.ok(st.nodes.some(n=>!n.token));
 assert.equal(applyCustomAction(h.b,u.ownerId,{kind:'wang.place',uid:u.uid,row:12,col:4}).ok,false);
 assert.equal(st.stock,before-1);assert.equal(ps.dp,dp-cost);checkInvariants(h.b);
});

test('Manual Wang placement rejects another owner, enemy tiles, invalid terrain and no stock/DP',()=>{
 const h=scenario(ids[0],0),u=h.unit(ids[0]),ps=h.b.getPlayer(u.ownerId),st=u.mem.wang;
 const action={kind:'wang.place',uid:u.uid,row:12,col:4};
 assert.equal(applyCustomAction(h.b,'other',action).reason,'unit');
 assert.equal(applyCustomAction(h.b,u.ownerId,{...action,row:10,col:7}).reason,'enemy');
 assert.equal(applyCustomAction(h.b,u.ownerId,{...action,row:-1}).reason,'tile');
 const stock=st.stock;ps.dp=0;assert.equal(applyCustomAction(h.b,u.ownerId,action).reason,'dp');assert.equal(st.stock,stock);
 st.stock=0;ps.dp=h.b.flags.dpMax;assert.equal(applyCustomAction(h.b,u.ownerId,action).reason,'stock');assert.equal(ps.dp,h.b.flags.dpMax);checkInvariants(h.b);
});

test('Chen S2 first strike follows the 17-frame begin clip; subsequent strikes are 0.4 seconds apart',()=>{
 const h=scenario(ids[1],1),u=h.unit(ids[1]),hits=[];
 h.b.on('damaged',ctx=>{if(ctx.source===u&&ctx.dmg.tags?.includes('chen3:slash'))hits.push(h.b.time);});
 const start=h.b.time;u.skill.activate('test',{free:true});
 assert.ok(u.s.flags.noBlock&&u.s.flags.invulnerable&&u.s.flags.untargetable);
 h.run(0.5);assert.equal(hits.length,0);h.run(4);
 assert.equal(hits.length,10);assert.ok(Math.abs(hits[0]-start-17/30)<0.035);
 for(let i=1;i<hits.length;i++)assert.ok(Math.abs(hits[i]-hits[i-1]-0.4)<1e-8);
 assert.ok(!u.skill.active);assert.ok(!u.s.flags.noBlock&&!u.s.flags.invulnerable);
 assert.ok(u.findBuff('chen3:afterDash'));const sp=u.skill.spTotal;u.skill.gainSp(50,'test');h.run(1);assert.equal(u.skill.spTotal,sp);
 h.run(5.5);assert.ok(!u.findBuff('chen3:afterDash'));assert.ok(u.skill.spTotal>sp);checkInvariants(h.b);
});

test('Chen S2 transfers to a nearby out-of-range enemy before an in-range enemy',()=>{
 const h=scenario(ids[1],1),u=h.unit(ids[1]),first=h.enemy(),seen=[];
 first.hp=1;const nearby=h.spawn('dummy',{pos:[10,7.2]}),inRange=h.spawn('dummy',{pos:[10,4]});
 h.b.on('damaged',ctx=>{if(ctx.source===u&&ctx.dmg.tags?.includes('chen3:slash'))seen.push(ctx.target.id);});
 u.skill.activate('test',{free:true});h.run(5);
 assert.equal(seen[0],first.id);assert.equal(seen[1],nearby.id);assert.ok(!seen.includes(inRange.id));
 assert.equal(seen.length,11);checkInvariants(h.b);
});

test('Chen wave travels straight at 1.5 tiles/s without homing and stops with the skill',()=>{
 const h=scenario(ids[1],2),u=h.unit(ids[1]);u.skill.activate('test',{free:true});h.run(0.5);
 const wave=u.mem.chenWave;assert.ok(Math.abs(wave.x-5.75)<0.06);assert.equal(wave.y,10);assert.equal(wave.turns,0);
 u.skill.stop();h.run(0.1);assert.equal(wave.active,false);const x=wave.x;h.run(1);assert.equal(wave.x,x);checkInvariants(h.b);
});
test('Chen wave delivers ordinary damage without an attack path rather than skill damage',()=>{
 const h=scenario(ids[1],2),u=h.unit(ids[1]),hits=[];
 h.b.on('damaged',ctx=>{if(ctx.dmg.tags?.includes('chen3:wave'))hits.push(ctx.dmg);});
 u.skill.activate('test',{free:true});h.run(0.6);assert.ok(hits.length>0);
 for(const hit of hits){assert.equal(hit.isSkill,false);assert.equal(hit.isAttack,false);}checkInvariants(h.b);
});
for(const [form,floor]of [['a',5.3],['b',5.5]])for(const ratio of [0.5,1,2])test(`Chen S3 ${form} wave uses the higher of current HP damage and ATK floor at threshold factor ${ratio}`,()=>{
 const id=ids[1].replace(/_a$/,`_${form}`),h=scenario(id,2),u=h.unit(id),e=h.b.enemies[0];
 u.skill.activate('test',{free:true});const atk=u.s.atk,initial=atk*floor/0.06*ratio;e.hp=initial;
 h.b.addBuff(u,{key:'test:after-launch',mods:{atkPct:10},flags:{disarm:true}});h.damage.length=0;
 h.run(0.1);const hits=h.damage.filter(d=>d.tags.includes('chen3:wave'));assert.equal(hits.length,1);
 assert.equal(hits[0].type,'arts');assert.ok(Math.abs(hits[0].amount-Math.max(initial*0.06,atk*floor))<1e-7);
 h.run(0.2);assert.equal(h.damage.filter(d=>d.tags.includes('chen3:wave')).length,1,'a straight segment never repeats damage');checkInvariants(h.b);
});
for(const [form,scale]of [['a',1.65],['b',1.8]])test(`Chen S3 ${form} attacks three enemies with three independent scaled hits each`,()=>{
 const id=ids[1].replace(/_a$/,`_${form}`),h=scenario(id,2),u=h.unit(id),enemies=[h.b.enemies[0],h.spawn('dummy',{pos:[11,6]}),h.spawn('dummy',{pos:[9,6]})],hits=[];
 h.b.on('damaged',ctx=>{if(ctx.source===u&&ctx.dmg.isAttack&&ctx.dmg.isSkill)hits.push({id:ctx.target.id,amount:ctx.amount});});
 u.skill.activate('test',{free:true});const atk=u.s.atk;assert.ok(h.runUntil(()=>hits.length>=9,4));
 assert.equal(hits.length,9);for(const e of enemies){const own=hits.filter(hit=>hit.id===e.id);assert.equal(own.length,3);assert.ok(own.every(hit=>Math.abs(hit.amount-atk*scale)<1e-7));}checkInvariants(h.b);
});
for(const [dir,dr,dc] of [['RIGHT',0,1],['LEFT',0,-1],['UP',1,0],['DOWN',-1,0]])test(`Chen wave turns at the exact quarter-tile boundary toward ${dir}`,()=>{
 const rows={};for(const r of [9,10,11])rows[r]='##rrrrrrrffrrrrrrr##'.split('');rows[10+dr][5+dc]='h';
 const h=makeBattle({autoFinish:false,flat:{rows:Object.fromEntries(Object.entries(rows).map(([r,v])=>[r,v.join('')]))},
 units:[{chessId:ids[1],row:10,col:5,dir,skillIndex:2}]});h.run(0.1);const u=h.unit(ids[1]);u.skill.activate('test',{free:true});const w=u.mem.chenWave;
 w.x=5+dc*0.249;w.y=10+dr*0.249;h.step();assert.equal(w.turns,0,'still more than 0.25 from the tile edge');
 w.x=5+dc*0.25;w.y=10+dr*0.25;h.step();assert.equal(w.turns,1);assert.deepEqual(w.v,[-dc,dr]);checkInvariants(h.b);
});

for(const glyph of ['h','S','E'])test(`Chen wave turns clockwise at ${glyph} terrain and resets per-segment hits`,()=>{
 const row='##hrrrrrrrfrrrrrrrf##'.split('');row[6]=glyph;
 const h=makeBattle({autoFinish:false,flat:{rows:{10:row.join('')}},defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}},
  units:[{chessId:ids[1],row:10,col:5,skillIndex:2}],enemies:[{key:'dummy',pos:[10,6]}]});
 h.run(0.1);const u=h.unit(ids[1]),hits=[];h.b.on('damaged',ctx=>{if(ctx.dmg.tags?.includes('chen3:wave'))hits.push(h.b.time);});
 u.skill.activate('test',{free:true});h.run(0.15);assert.equal(hits.length,1,'one hit before the turn');
 h.run(0.4);assert.equal(u.mem.chenWave.turns,1);assert.deepEqual(u.mem.chenWave.v,[-1,0]);assert.equal(hits.length,2,'one new hit after the turn');checkInvariants(h.b);
});
for(const elite of [false,true])test(`Wisdel S3 preserves all six main and aftershock damage amounts (${elite?'elite':'normal'})`,()=>{
 const id=ids[4].replace(/_a$/,elite?'_b':'_a'),h=scenario(id,2),u=h.unit(id),main=[],after=[];
 h.b.on('damaged',c=>{if(c.source!==u)return;if(c.dmg.isAttack&&!c.dmg.isSplash&&c.dmg.isSkill)main.push(c.amount);if(c.dmg.tags?.includes('aftershock')&&c.dmg.isSkill)after.push(c.amount);});
 u.skill.activate('test',{free:true});const atk=u.s.atk,scale=elite?1.9:1.75;
 assert.ok(h.runUntil(()=>!u.skill.active,60));h.b.addBuff(u,{key:'test:stop-new-attacks',flags:{disarm:true}});h.run(1);
 assert.equal(main.length,6);assert.equal(after.length,elite?12:6);
 for(const amount of main)assert.ok(Math.abs(amount-atk*scale*1.15)<1e-6,`main hit ${amount} should equal ${atk*scale*1.15}`);
 for(const amount of after)assert.ok(Math.abs(amount-atk*scale*.5*1.15)<1e-6,`aftershock ${amount} should equal ${atk*scale*.5*1.15}`);
});
for(const elite of [false,true])test(`Wisdel S3 shadow explosion uses talent scale and midpoint radius (${elite?'elite':'normal'})`,()=>{
 const h=scenario(ids[4].replace(/_a$/,elite?'_b':'_a'),2),u=h.unit('caster'),e=h.b.enemies[0],inside=h.spawn('dummy',{pos:[10,8.09]}),outside=h.spawn('dummy',{pos:[10,8.11]}),hits=[];
 h.b.addBuff(u,{key:'test:no-attacks',flags:{disarm:true}});u.skill.activate('test',{free:true});
 const atk=u.s.atk,scale=u.def.raw.talents[0].bb['attack@bomb_atk_scale'];e.mem[`wisdel:${u.id}`]=true;
 h.b.on('damaged',c=>{if(c.source===u&&c.dmg.tags?.includes('wisdel:explosion'))hits.push(c);});
 h.b.emit('wisdel:detonate',{source:u,target:e,isSkill:true,guaranteed:true,atk});
 assert.equal(hits.length,2);assert.ok(hits.some(c=>c.target===e));assert.ok(hits.some(c=>c.target===inside));assert.ok(!hits.some(c=>c.target===outside));
 for(const c of hits)assert.ok(Math.abs(c.amount-atk*scale)<1e-6,'explosion does not inherit main-target or S3 attack multipliers');
 assert.equal(e.mem[`wisdel:${u.id}`],true);checkInvariants(h.b);
});
for(const elite of [false,true])test(`Sakiko S3 creates two notes of each damage type and keeps launch ATK (${elite?'elite':'normal'})`,()=>{
 const h=scenario(ids[3].replace(/_a$/,elite?'_b':'_a'),2),u=h.unit('caster'),hits=[];
 u.mem.oblvns.notes=[];u.skill.activate('test',{free:true});const atk=u.s.atk,scale=elite?1.8:1.55,remote=elite?1:.8;
 assert.ok(h.runUntil(()=>u.mem.oblvns.notes.length>=4,3));const notes=[...u.mem.oblvns.notes];assert.equal(notes.length,4);
 assert.equal(notes.filter(n=>n.type==='phys').length,2);assert.equal(notes.filter(n=>n.type==='arts').length,2);
 for(const n of notes){assert.equal(n.skill,true);assert.ok(Math.abs(n.atk-atk*scale*remote)<1e-6);}
 h.b.addBuff(u,{key:'test:changed-ATK',mods:{atkPct:10},flags:{disarm:true}});
 h.b.on('damaged',c=>{if(c.source===u&&c.dmg.tags?.includes('oblvns:note'))hits.push(c);});
 assert.ok(h.runUntil(()=>hits.length>=4,8));assert.equal(hits.length,4);
 for(const c of hits)assert.ok(Math.abs(c.amount-atk*scale*remote)<1e-6,'launched notes retain damage after caster ATK changes');
 assert.equal(hits.filter(c=>c.type==='phys').length,2);assert.equal(hits.filter(c=>c.type==='arts').length,2);checkInvariants(h.b);
});
for(const elite of [false,true])for(const count of [2,3,4])test(`Wang S3 ${elite?'elite':'normal'} snapshots ${count}-piece line layers and uses cross-shaped trigger damage`,()=>{
 const h=scenario(ids[0].replace(/_a$/,elite?'_b':'_a'),2),u=h.unit('caster'),st=u.mem.wang;
 for(const e of h.b.enemies)h.b.kill(e);u.skill.activate('test',{free:true});
 const nodes=Array.from({length:count},(_,i)=>({r:12,c:2+i,active:true,token:null}));st.nodes=nodes;h.run(.2);
 const layers=Math.min(count,3);assert.equal(nodes[0].activation.layers,layers);for(const n of nodes.slice(1))n.active=false;
 const center=h.spawn('dummy',{pos:[12,2]}),edge=h.spawn('dummy',{pos:[12,4]}),beyond=h.spawn('dummy',{pos:[12,5]}),diagonal=h.spawn('dummy',{pos:[13,3]});
 for(const e of [center,edge,beyond,diagonal]){e.base.res=60;e.markDirty();}
 const atk=u.s.atk,want=atk*(elite?3.2:2.9)*(1+layers*(elite?.15:.12))*(1-(60-layers*(elite?13:10))/100),hits=[];
 h.b.on('damaged',c=>{if(c.dmg.tags?.includes('wang:stone'))hits.push(c);});h.run(.2);
 assert.equal(hits.length,2);assert.ok(hits.some(c=>c.target===center));assert.ok(hits.some(c=>c.target===edge));
 for(const c of hits)assert.ok(Math.abs(c.amount-want)<1e-6,`stone damage ${c.amount} expected ${want}`);
 assert.equal(beyond.hp,beyond.maxHp);assert.equal(diagonal.hp,diagonal.maxHp);assert.equal(nodes[0].active,false);checkInvariants(h.b);
});
for(const elite of [false,true])for(const retreat of [false,true])test(`Chen S3 wave stops after ${retreat?'permanent retreat':'natural expiry'} (${elite?'elite':'normal'})`,()=>{
 const h=scenario(ids[1].replace(/_a$/,elite?'_b':'_a'),2),u=h.unit('caster'),hits=[];
 h.b.on('damaged',c=>{if(c.dmg.tags?.includes('chen3:wave'))hits.push(c);});u.skill.activate('test',{free:true});h.run(.2);const wave=u.mem.chenWave;
 assert.equal(wave.active,true);assert.ok(hits.length>0);
 if(retreat)h.b.retreat(u,{permanent:true});else assert.ok(h.runUntil(()=>!u.skill.active,90));
 h.run(.1);assert.equal(wave.active,false);const count=hits.length,position=[wave.x,wave.y];h.run(2);
 assert.equal(hits.length,count);assert.deepEqual([wave.x,wave.y],position);assert.equal(h.b.errors.length,0);checkInvariants(h.b);
});
for(const elite of [false,true])for(const count of [4,12,20])test(`Sakiko S3 ${elite?'elite':'normal'} applies current ${count}-note penetration with talent cap`,()=>{
 const h=scenario(ids[3].replace(/_a$/,elite?'_b':'_a'),2),u=h.unit('caster'),e=h.b.enemies[0];u.skill.activate('test',{free:true});
 e.base.def=300;e.base.res=80;e.markDirty();u.mem.oblvns.notes=Array.from({length:count},()=>({state:'free'}));
 const layers=Math.min(count,elite?12:10),phys=1000-300*(1-layers*(elite?.05:.03)),arts=1000*(1-.8*(1-layers*(elite?.025:.02)));
 assert.ok(Math.abs(h.b.dealDamage(u,e,{amount:1000,type:'phys',canDodge:false,isSkill:true})-phys)<1e-6);
 assert.ok(Math.abs(h.b.dealDamage(u,e,{amount:1000,type:'arts',canDodge:false,isSkill:true})-arts)<1e-6);checkInvariants(h.b);
});
for(const elite of [false,true])test(`Sakiko S3 penetration helps only original members owned by its player (${elite?'elite':'normal'})`,()=>{
 const id=ids[3].replace(/_a$/,elite?'_b':'_a'),h=makeBattle({kind:'unite',autoFinish:false,
 defs:{chess:{member:chessRec({id:'member',charId:'char_4183_mortis',skill:null}),outsider:chessRec({id:'outsider',charId:'unrelated',skill:null})},enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}},
 players:[{playerId:'p1',side:'L',units:[{chessId:id,uid:'sakiko',row:10,col:5,skillIndex:2},{chessId:'member',uid:'own',row:11,col:6},{chessId:'outsider',uid:'outsider',row:12,col:6}]},{playerId:'p2',side:'R',colOffset:10,units:[{chessId:'member',uid:'foreign',row:11,col:4}]}],enemies:[{key:'dummy',pos:[10,7]}]});
 h.run(.1);const u=h.unit('sakiko'),e=h.b.enemies[0];u.skill.activate('test',{free:true});u.mem.oblvns.notes=Array.from({length:4},()=>({state:'free'}));e.base.def=300;e.base.res=80;e.markDirty();
 const own=h.b.dealDamage(h.unit('own'),e,{amount:1000,type:'phys',canDodge:false});assert.ok(Math.abs(own-(1000-300*(1-4*(elite?.05:.03))))<1e-6);
 for(const uid of ['outsider','foreign'])assert.equal(h.b.dealDamage(h.unit(uid),e,{amount:1000,type:'phys',canDodge:false}),700);checkInvariants(h.b);
});
for(const elite of [false,true])test(`Sakiko S3 Fever combines free casts, paused durations and scoped fatal protection (${elite?'elite':'normal'})`,()=>{
 const id=ids[3].replace(/_a$/,elite?'_b':'_a'),h=makeBattle({kind:'unite',autoFinish:false,timeLimit:80,
 defs:{chess:{member:chessRec({id:'member',charId:'char_4183_mortis',skill:{duration:30,spCost:100}}),held:chessRec({id:'held',charId:'char_4184_dolris',skill:{duration:30,spCost:100}}),outsider:chessRec({id:'outsider',skill:{duration:30,spCost:100}})},enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}},
 players:[{playerId:'p1',side:'L',units:[{chessId:id,uid:'sakiko',row:10,col:5,skillIndex:2},{chessId:'member',uid:'own',row:11,col:6},{chessId:'held',uid:'held',row:12,col:6},{chessId:'outsider',uid:'outsider',row:12,col:7}]},{playerId:'p2',side:'R',colOffset:10,units:[{chessId:'member',uid:'foreign',row:11,col:4}]}],enemies:[{key:'dummy',pos:[10,7]}]});
 h.run(.1);const u=h.unit('sakiko'),own=h.unit('own'),held=h.unit('held'),outsider=h.unit('outsider'),foreign=h.unit('foreign'),e=h.b.enemies[0];
 held.skill.activate('test',{free:true});h.run(1);const saved=held.skill.timeLeft,sp=own.skill.spTotal,f=h.b.customFever.get(u.ownerId);f.value=450;u.skill.activate('test',{free:true});h.run(.1);
 assert.equal(f.value,0);assert.equal(own.skill.active,true);assert.ok(Math.abs(own.skill.spTotal-sp)<.2);assert.equal(outsider.skill.active,false);assert.equal(foreign.skill.active,false);
 for(const target of [own,outsider,foreign])h.b.dealDamage(e,target,{amount:1e7,type:'true'});
 assert.equal(own.alive,true);assert.equal(own.hp,1);assert.equal(own.mem.oblvnsFatal,true);assert.equal(outsider.alive,false);assert.equal(foreign.alive,false);
 h.run(5);assert.ok(Math.abs(held.skill.timeLeft-saved)<.07);h.run(15.1);
 assert.equal(f.until,0);assert.equal(own.alive,false);assert.equal(own.mem.oblvnsFatal,false);assert.equal(u.skill.active,false);assert.equal(held.skill.active,true);assert.ok(Math.abs(held.skill.timeLeft-saved)<.3);assert.equal(h.b.errors.length,0);checkInvariants(h.b);
});
for(const elite of [false,true])test(`Wisdel S3 explosion hits flying enemies with physical mitigation while only S3 aftershock gains aerial coverage (${elite?'elite':'normal'})`,()=>{
 const id=ids[4].replace(/_a$/,elite?'_b':'_a'),h=makeBattle({autoFinish:false,defs:{enemies:{ground:enemyRec({key:'ground',hp:1e8,def:400,speed:0,atk:0}),air:enemyRec({key:'air',hp:1e8,def:400,motion:'FLY',speed:0,atk:0})}},units:[{chessId:id,uid:'caster',row:10,col:5,skillIndex:2}],enemies:[{key:'ground',pos:[10,7]},{key:'air',pos:[10,7.8],route:2}]});
 h.run(.1);const u=h.unit('caster'),ground=h.b.enemies.find(e=>!e.isFlying),air=h.b.enemies.find(e=>e.isFlying),hits=[];assert.equal(air.isFlying,true);
 h.b.addBuff(u,{key:'test:no-attacks',flags:{disarm:true}});u.skill.activate('test',{free:true});const atk=u.s.atk,scale=u.def.raw.talents[0].bb['attack@bomb_atk_scale'];ground.mem[`wisdel:${u.id}`]=true;
 h.b.on('damaged',c=>{if(c.source===u)hits.push(c);});h.b.emit('wisdel:detonate',{source:u,target:ground,isSkill:true,guaranteed:true,atk});
 const explosions=hits.filter(c=>c.dmg.tags?.includes('wisdel:explosion'));assert.equal(explosions.length,2);assert.ok(explosions.some(c=>c.target===air));
 for(const c of explosions){assert.equal(c.type,'phys');assert.ok(Math.abs(c.amount-Math.max(atk*scale-400,atk*scale*.05))<1e-6);}
 hits.length=0;u.profile.afterHit(h.b,u,ground,{x:ground.x,y:ground.y,isSkill:true,atk});h.run(.7);
 assert.ok(hits.some(c=>c.target===ground&&c.dmg.tags?.includes('aftershock')));assert.ok(hits.some(c=>c.target===air&&c.dmg.tags?.includes('aftershock')));
 hits.length=0;u.profile.afterHit(h.b,u,ground,{x:ground.x,y:ground.y,isSkill:false,atk});h.run(.4);
 assert.ok(!hits.some(c=>c.target===air&&c.dmg.tags?.includes('aftershock')),'ordinary aftershock remains ground-only');checkInvariants(h.b);
});
for(const elite of [false,true])test(`Chen S3 turns again when the clockwise path is also blocked (${elite?'elite':'normal'})`,()=>{
 const rows={};for(const r of [9,10,11])rows[r]='##rrrrrrrffrrrrrrr##'.split('');rows[10][6]='h';rows[9][5]='h';
 const id=ids[1].replace(/_a$/,elite?'_b':'_a'),h=makeBattle({autoFinish:false,flat:{rows:Object.fromEntries(Object.entries(rows).map(([r,v])=>[r,v.join('')]))},defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}},units:[{chessId:id,uid:'caster',row:10,col:5,skillIndex:2}],enemies:[{key:'dummy',pos:[10,5.5]}]});
 h.run(.1);const u=h.unit('caster'),hits=[];h.b.on('damaged',c=>{if(c.dmg.tags?.includes('chen3:wave'))hits.push(c);});u.skill.activate('test',{free:true});const wave=u.mem.chenWave;wave.x=5.25;wave.y=9.75;
 assert.ok(h.runUntil(()=>wave.turns===1,.2));assert.equal(wave.turns,1);assert.deepEqual(wave.v,[-1,0]);assert.deepEqual([wave.x,wave.y],[5.25,9.75],'does not enter the second blocked tile');assert.equal(hits.length,1);
 assert.ok(h.runUntil(()=>wave.turns===2,.2));assert.equal(wave.turns,2);assert.deepEqual(wave.v.map(v=>v||0),[0,-1]);assert.ok(Math.abs(wave.x-5.2)<1e-9);assert.equal(wave.y,9.75);assert.equal(hits.length,2,'the next turn permits another hit');
 h.run(.2);assert.equal(wave.turns,2);assert.equal(hits.length,2,'straight movement does not repeat damage');assert.equal(h.b.errors.length,0);checkInvariants(h.b);
});

for(const form of ['a','b'])test(`Kaltsit S2 ${form} airborne talent blocks flyers but rejects ground blocking and ground attacks`,()=>{
 const id=`chess_custom_5_kalts2_${form}`,h=makeBattle({autoFinish:false,
  units:[{chessId:id,row:10,col:5,uid:'medic',skillIndex:1}],
  defs:{enemies:{ground:enemyRec({key:'ground',hp:1e8,speed:0,atk:0}),air:enemyRec({key:'air',hp:1e8,speed:0,atk:0,motion:'FLY'})}},
  enemies:[{key:'ground',pos:[10,5.5]},{key:'air',pos:[10,5.5],route:2}]});
 assert.ok(h.runUntil(()=>h.enemies().length===2,3));h.run(0.2);const u=h.unit('medic'),ground=h.enemies().find(e=>!e.isFlying),air=h.enemies().find(e=>e.isFlying);
 assert.equal(ground.blockedBy,null);assert.equal(air.blockedBy,u);assert.ok(u.blocking.includes(air));
 const before=u.hp;
 assert.equal(h.b.dealDamage(ground,u,{amount:100,type:'true',canDodge:false}),0);
 assert.equal(u.hp,before);
 assert.equal(h.b.dealDamage(air,u,{amount:100,type:'true',canDodge:false}),100);
 assert.equal(u.hp,before-100);
 u.skill.activate('test',{free:true});h.run(0.1);
 assert.equal(air.blockedBy,u);assert.equal(ground.blockedBy,null);checkInvariants(h.b);
});

for(const form of ['a','b'])test(`Wisdel S3 ${form} acquires aerial targets and splashes through the 2.5-tile boundary`,()=>{
 const hits=[],h=makeBattle({autoFinish:false,
  units:[{chessId:`chess_custom_5_wisdel_${form}`,uid:'wis',row:10,col:5,skillIndex:2}],
  defs:{enemies:{air:enemyRec({key:'air',hp:1e8,speed:0,atk:0,motion:'FLY'})}},
  setup(b){b.on('damaged',c=>hits.push(c));}});
 h.run(.1);const u=h.unit('wis'),main=h.spawn('air',{pos:[10,7],routeIndex:2}),edge=h.spawn('air',{pos:[10,9.49],routeIndex:2}),outside=h.spawn('air',{pos:[10,9.51],routeIndex:2});
 assert.ok(main.isFlying&&edge.isFlying&&outside.isFlying);
 main.base.tauntLevel=100;main.markDirty();
 h.run(.3);assert.ok(!hits.some(c=>c.source===u),'ordinary attacks cannot target flyers');
 u.skill.activate('test',{free:true});
 assert.ok(h.runUntil(()=>hits.some(c=>c.source===u&&c.target===main&&c.dmg.isAttack),8));
 h.b.addBuff(u,{key:'test:stop-next-shot',flags:{disarm:true}});h.run(.4);
 assert.ok(hits.some(c=>c.source===u&&c.target===edge&&c.dmg.isAttack&&c.dmg.isSplash),'aerial splash reaches 2.49 tiles');
 assert.ok(!hits.some(c=>c.source===u&&c.target===outside&&c.dmg.isAttack),'aerial splash excludes 2.51 tiles '+JSON.stringify({main:[main.x,main.y],edge:[edge.x,edge.y],outside:[outside.x,outside.y],hits:hits.filter(c=>c.dmg.isAttack).map(c=>[c.target.id,c.dmg.isSplash])}));
 assert.equal(u.skill.ammoLeft,5);checkInvariants(h.b);
});

for(const form of ['a','b'])test(`Wisdel S3 ${form} shares blast-lock priority and clears only the interrupted owner's lock`,()=>{
 const h=makeBattle({autoFinish:false,units:[{chessId:`chess_custom_5_wisdel_${form}`,uid:'first',row:10,col:5,skillIndex:2},{chessId:`chess_custom_5_wisdel_${form}`,uid:'second',row:10,col:4,skillIndex:2}],defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}}});
 h.run(.1);const first=h.unit('first'),second=h.unit('second');first.atkCd=second.atkCd=100;
 const locked=h.spawn('dummy',{pos:[10,7]}),other=h.spawn('dummy',{pos:[10,6]});h.run(.05);
 first.skill.activate('test',{free:true});second.skill.activate('test',{free:true});
 const one={attacker:first,targets:[locked],isSkill:true,profile:{}};h.b.emit('beforeAttack',one);
 assert.deepEqual(one.targets,[locked]);assert.ok(locked.mem.wisBlastLocks[first.id]>h.b.time);
 assert.ok(h.b.enemiesInKeys(second.rangeKeys,second,{canHitFly:true}).includes(locked),JSON.stringify({range:second.rangeKeys,alive:second.alive,deployed:second.deployed,lock:locked.mem.wisBlastLocks}));
 const two={attacker:second,targets:[other],isSkill:true,profile:{}};h.b.emit('beforeAttack',two);
 assert.deepEqual(two.targets,[locked],'another Wisdel prioritizes the shared locked target');
 h.b.retreat(first,{reason:'test',permanent:true});
 assert.equal(locked.mem.wisBlastLocks[first.id],undefined);assert.ok(locked.mem.wisBlastLocks[second.id]>h.b.time);
 h.b.applyStatus(second,'stun',{duration:1,source:other});h.run(.1);
 assert.equal(locked.mem.wisBlastLocks[second.id],undefined);checkInvariants(h.b);
});
for(const form of ['a','b'])test(`Wisdel S3 ${form} blast lock expires at the model's attack-finished event`,()=>{
 const h=scenario(ids[4].replace(/_a$/,`_${form}`),2),u=h.unit('caster'),e=h.b.enemies[0];u.atkCd=100;u.skill.activate('test',{free:true});
 h.b.emit('beforeAttack',{attacker:u,targets:[e],isSkill:true,profile:{}});
 const duration=(1.5-16/30)*100/u.s.aspd;
 assert.ok(Math.abs(u.mem.wisLock.until-h.b.time-duration)<1e-6);
 h.run(duration-.08);assert.ok(e.mem.wisBlastLocks[u.id]>h.b.time);
 h.run(.12);assert.equal(e.mem.wisBlastLocks[u.id],undefined);assert.equal(u.mem.wisLock,null);checkInvariants(h.b);
});

test('Wisdel elite S3 without a module retains one aftershock per bullet',()=>{
 const hits=[],h=makeBattle({autoFinish:false,timeLimit:100,
  units:[{chessId:'chess_custom_5_wisdel_b',uid:'wis',row:10,col:5,skillIndex:2,moduleId:'none'}],
  defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}},enemies:[{key:'dummy',pos:[10,7]}],
  setup(b){b.on('damaged',c=>hits.push(c));}});
 h.run(.1);const u=h.unit('wis');assert.equal(u.def.raw.module.active,false);assert.equal(u.profile.shockTimes,2);
 u.skill.activate('test',{free:true});assert.ok(h.runUntil(()=>!u.skill.active,60));
 h.b.addBuff(u,{key:'test:end-attacks',flags:{disarm:true}});h.run(1);
 assert.equal(hits.filter(c=>c.source===u&&c.dmg.isSkill&&c.dmg.isAttack&&!c.dmg.isSplash).length,6);
 assert.equal(hits.filter(c=>c.source===u&&c.dmg.isSkill&&c.dmg.tags?.includes('aftershock')).length,6);checkInvariants(h.b);
});

for(const firstSucceeds of [false,true])test(`Wisdel elite module rolls each ordinary aftershock independently (${firstSucceeds?'first succeeds':'second succeeds'})`,()=>{
 const h=makeBattle({autoFinish:false,units:[{chessId:'chess_custom_5_wisdel_b',uid:'wis',row:10,col:5,skillIndex:2}],defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}}});
 const u=h.unit('wis'),rolls=[],explosions=[];
 h.b.addBuff(u,{key:'test:no-further-attacks',persist:true,flags:{disarm:true}});h.run(1.1);u.atkCd=Infinity;const e=h.spawn('dummy',{pos:[10,7]});h.run(.05);
 h.b.rng.chance=p=>{if(p===0.15){rolls.push(h.b.time);return firstSucceeds||rolls.length===2;}return false;};
 h.b.on('damaged',c=>{if(c.source===u&&c.dmg.tags?.includes('wisdel:explosion'))explosions.push(h.b.time);});
 e.mem[`wisdel:${u.id}`]=true;
 u.profile.afterHit(h.b,u,e,{x:e.x,y:e.y,atk:u.s.atk,isSkill:false});
 h.run(5/30);
 assert.equal(rolls.length,1,JSON.stringify(rolls));assert.equal(explosions.length,firstSucceeds?1:0);
 assert.equal(e.mem[`wisdel:${u.id}`],true);
 h.run(.3);
 assert.equal(rolls.length,firstSucceeds?1:2);assert.equal(explosions.length,1);
 assert.equal(e.mem[`wisdel:${u.id}`],true);checkInvariants(h.b);
});

for(const elite of [false,true])test(`Wisdel actual main hit resolves explosion at 4f and shocks at 8f/12f (${elite?'elite':'normal'})`,()=>{
 const id=ids[4].replace(/_a$/,elite?'_b':'_a'),h=scenario(id,2),u=h.unit('caster');
 h.b.addBuff(u,{key:'test:hold',persist:true,flags:{disarm:true}});h.run(1.1);const e=h.b.enemies[0],events=[];
 u.skill.activate('test',{free:true});const start=h.b.time;
 h.b.on('damaged',c=>{if(c.source===u)events.push({tag:c.dmg.tags?.includes('wisdel:explosion')?'explosion':c.dmg.tags?.includes('aftershock')?'shock':'main',frame:Math.round((h.b.time-start)*30)});});
 const prof=effectiveProfile(u);prof.atkSnapshot=u.s.atk;
 resolveHit(h.b,u,prof,e,{isSkill:true,attackId:100},e.x,e.y);h.run(.5);
 assert.deepEqual(events.map(v=>[v.tag,v.frame]),elite?[['main',0],['explosion',4],['shock',8],['shock',12]]:[['main',0],['explosion',4],['shock',8]]);
 checkInvariants(h.b);
});
for(const reverse of [false,true])test(`Wisdel simultaneous casters detonate all marked enemies before shocks (${reverse?'B first':'A first'})`,()=>{
 const h=makeBattle({autoFinish:false,units:[{chessId:'chess_custom_5_wisdel_b',uid:'A',row:10,col:5,skillIndex:2},{chessId:'chess_custom_5_wisdel_a',uid:'B',row:10,col:4,skillIndex:2}],defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}}});
 h.run(1.1);const casters=[h.unit('A'),h.unit('B')];for(const u of casters)u.atkCd=Infinity;
 const es=[h.spawn('dummy',{pos:[10,7]}),h.spawn('dummy',{pos:[10,7.5]})];h.run(.1);
 for(const u of casters){u.skill.activate('test',{free:true});for(const e of es)e.mem[`wisdel:${u.id}`]=true;}
 const events=[],start=h.b.time;h.b.on('damaged',c=>{if(c.dmg.tags?.includes('wisdel:explosion')||c.dmg.tags?.includes('aftershock'))events.push({source:c.source,amount:c.amount,tag:c.dmg.tags.includes('wisdel:explosion')?'explosion':'shock',frame:Math.round((h.b.time-start)*30)});});
 for(const u of reverse?[...casters].reverse():casters)u.profile.afterHit(h.b,u,es[0],{x:es[0].x,y:es[0].y,atk:u.s.atk,isSkill:true});
 h.run(.5);const explosions=events.filter(v=>v.tag==='explosion');assert.equal(explosions.length,16);assert.ok(explosions.every(v=>v.frame===4));assert.ok(events.slice(0,16).every(v=>v.tag==='explosion'));
 for(const v of explosions)assert.ok(Math.abs(v.amount-v.source.s.atk*v.source.def.raw.talents[0].bb['attack@bomb_atk_scale'])<1e-6);
 for(const e of es)for(const u of casters)assert.equal(e.mem[`wisdel:${u.id}`],true);
 checkInvariants(h.b);
});

for(const first of ['B','A'])test(`Wisdel crossed residuals follow ${first}'s first shock then the other caster's shock`,()=>{
 const h=makeBattle({autoFinish:false,units:[{chessId:'chess_custom_5_wisdel_a',uid:'B',row:10,col:5,skillIndex:2},{chessId:'chess_custom_5_wisdel_a',uid:'A',row:10,col:4,skillIndex:2}],defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}}});
 h.run(1.1);const units=[h.unit('B'),h.unit('A')];for(const u of units)u.atkCd=Infinity;
 const e=h.spawn('dummy',{pos:[10,7]});h.run(.1);for(const u of units){u.skill.activate('test',{free:true});e.mem[`wisdel:${u.id}`]=true;}
 const events=[],start=h.b.time;h.b.on('damaged',c=>{if(c.dmg.tags?.includes('wisdel:explosion')||c.dmg.tags?.includes('aftershock'))events.push([c.source===units[0]?'B':'A',c.dmg.tags.includes('wisdel:explosion')?'explosion':'shock',Math.round((h.b.time-start)*30)]);});
 const one=h.unit(first),two=h.unit(first==='B'?'A':'B');one.profile.afterHit(h.b,one,e,{x:e.x,y:e.y,atk:one.s.atk,isSkill:true});h.run(4/30);
 two.profile.afterHit(h.b,two,e,{x:e.x,y:e.y,atk:two.s.atk,isSkill:true});h.run(.5);
 assert.deepEqual(events,[['B','explosion',4],['A','explosion',4],[first,'shock',8],['B','explosion',8],['A','explosion',8],[first==='B'?'A':'B','shock',12]]);
 for(const u of units)assert.equal(e.mem[`wisdel:${u.id}`],true);checkInvariants(h.b);
});

for(const form of ['a','b'])test(`Wang S3 ${form} automatically replenishes empty inventory without a basic attack target`,()=>{
 const id=`chess_custom_6_wang_${form}`,h=makeBattle({autoFinish:false,units:[{chessId:id,uid:'wang',row:10,col:5,skillIndex:2}],defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0,atk:0})}},enemies:[{key:'dummy',pos:[12,7]}]});
 h.run(.1);const u=h.unit('wang');u.mem.wang.stock=0;u.skill.setSpTotal(u.skill.spCost);h.run(.2);
 assert.equal(u.skill.active,true);assert.equal(u.mem.wang.stock,u.mem.wang.maxStock);
 assert.equal(u.mem.wang.stock,8);assert.equal(u.mem.wang.nodes.length,0,'eight replenished pieces fit the full-potential inventory');checkInvariants(h.b);
});

for(const form of ['a','b'])test(`Wang S3 ${form} naturally refills and damages in three successive cycles`,()=>{
 const id=`chess_custom_6_wang_${form}`,starts=[],ends=[],hits=[];
 const h=makeBattle({autoFinish:false,timeLimit:300,units:[{chessId:id,uid:'wang',row:10,col:5,skillIndex:2}],defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e9,speed:0,atk:0})}},enemies:[{key:'dummy',pos:[12,5]}],setup(b){
  b.on('skillStart',c=>{if(c.unit.uid==='wang')starts.push({time:b.time,stock:c.unit.mem.wang.stock});});
  b.on('skillEnd',c=>{if(c.unit.uid==='wang')ends.push({time:b.time,reason:c.reason});});
  b.on('damaged',c=>{if(c.dmg.tags?.includes('wang:stone'))hits.push({time:b.time,amount:c.amount});});
 }});
 h.run(.1);const u=h.unit('wang');assert.equal(applyCustomAction(h.b,u.ownerId,{kind:'wang.place',uid:u.uid,row:12,col:4}).ok,true);
 h.run(220);assert.equal(starts.length,3);assert.equal(ends.length,3);
 for(let i=0;i<3;i++){assert.equal(starts[i].stock,8);assert.equal(ends[i].reason,'empty');assert.ok(hits.some(v=>v.time>=starts[i].time&&v.time<=ends[i].time&&v.amount>0));}
 assert.ok(hits.some(v=>v.time>ends[2].time),'returned pieces keep automatically deploying and damaging');
 assert.deepEqual(h.b.errors,[]);checkInvariants(h.b);
});
for(const form of ['a','b'])for(const inside of [true,false])test(`Wang S3 ${form} ${inside?'inside':'outside'} range controls timed paid followers`,()=>{
 const id=`chess_custom_6_wang_${form}`,h=makeBattle({autoFinish:false,flat:{rows:{9:'##rrrrrrrrrrrrrrrrr##',10:'##rrrrrrrrrrrrrrrrr##',11:'##rrrrrrrrrrrrrrrrr##',12:'##rrrrrrrrrrrrrrrrr##'}},units:[{chessId:id,uid:'wang',row:10,col:5,skillIndex:2}]});
 h.run(.1);const u=h.unit('wang'),st=u.mem.wang;st.stock=0;u.skill.activate('test',{free:true});st.nodes=[];
 const col=inside?7:3;assert.equal(u.rangeKeys.includes(10*COLS+col),inside);h.b.getPlayer(u.ownerId).dp=h.b.flags.dpMax;
 assert.ok(applyCustomAction(h.b,u.ownerId,{kind:'wang.place',uid:u.uid,row:10,col}).ok);
 const count=()=>st.nodes.filter(n=>!n.token).length;assert.equal(count(),1);assert.equal(u.skill.ammoLeft,20);
 h.step();for(let i=1;i<=3;i++){h.run(8/30);assert.equal(count(),inside?i:1);h.run(1/30);assert.equal(count(),inside?i+1:1);assert.equal(u.skill.ammoLeft,inside?20-i:20);}
 for(const n of st.nodes.filter(n=>!n.token)){assert.equal(Math.abs(n.r-10)+Math.abs(n.c-col),1);assert.ok(h.b.grid.canStand(n.r,n.c,{ranged:true}));}checkInvariants(h.b);
});
