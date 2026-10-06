// Shared, deterministic entry point for human inputs. Authentication and transport
// live above the simulation; ownership and current gameplay legality are checked here.
import {COLS} from './constants.js';
import {bodyInKeys} from './body.js';
const STONE='token_10064_wang_stone1';
const ANCHOR='token_10068_kalts2_mtship';
const live=u=>u?.alive&&u.deployed&&!u.removed;
const refuse=reason=>({ok:false,reason});

export const CUSTOM_ACTION_LIMIT=2048;
export function beginKaltsTravel(b,u,anchor){
 u.mem.kaltsAnchorAvailable=false;
 const pos=[anchor.tileR,anchor.tileC];b.retreat(anchor,{reason:'expired',permanent:true});
 u.mem.kaltsTravel={pos,home:[u.tileR,u.tileC],touched:new Map()};
 b.releaseBlocked(u);b.addBuff(u,{key:'kalts2:travel',flags:{invulnerable:true,disarm:true,noBlock:true}});
}
export function normalizeCustomInput(input){
 if(!input||!Number.isInteger(input.tick)||input.tick<0||input.tick>54000)return null;
 if(typeof input.playerId!=='string'||!input.playerId.length||input.playerId.length>64)return null;
 const a=input.action;
 const uid=v=>Number.isInteger(v)&&v>0||typeof v==='string'&&v.length>0&&v.length<=64;
 if(!a||!['wang.place','kalts.move','kalts.anchor'].includes(a.kind)||!uid(a.uid))return null;
 if(a.kind==='kalts.move'&&!uid(a.targetUid))return null;
 if(!Number.isInteger(a.row)||!Number.isInteger(a.col))return null;
 return {tick:input.tick,playerId:input.playerId,action:{kind:a.kind,uid:a.uid,row:a.row,col:a.col,...(a.kind==='kalts.move'?{targetUid:a.targetUid}:{})}};
}

export function applyCustomAction(b,playerId,a){
 if(!a||typeof a!=='object'||Array.isArray(a)||b.finished)return refuse('inactive');
 const u=b.allyUnits.find(u=>u.ownerId===playerId&&u.uid===a.uid&&u.kind==='op');
 if(!live(u))return refuse('unit');
 if(a.kind==='kalts.anchor'){
  if(u.skill?.id!=='skchr_kalts2_3'||!u.skill.active||u.mem.kaltsTravel||!u.mem.kaltsAnchorAvailable)return refuse('action');
  const {row:r,col:c}=a,k=r*COLS+c;
  if(!Number.isInteger(r)||!Number.isInteger(c)||!b.grid.inRect(r,c)||!b.grid.canStand(r,c,{ranged:true})||b.isReservedTile(r,c)||u.rangeKeys.includes(k))return refuse('tile');
  if(b.grid.tile(r,c).height!=='HIGH'&&!b._elevated?.has(k))return refuse('tile');
  const def=b.tokenDef(ANCHOR,u),ps=b.getPlayer(playerId),cost=Math.max(0,def?.stats.cost||0);
  if(!def)return refuse('token');if(!ps||ps.dp+1e-9<cost)return refuse('dp');
  const token=b.spawnToken(u,ANCHOR,r,c);if(!token)return refuse('deploy');
  ps.dp-=cost;beginKaltsTravel(b,u,token);return {ok:true,unitId:token.id,tile:k};
 }
 if(a.kind==='kalts.move'){
  if(u.skill?.id!=='skchr_kalts2_3'||!u.skill.active||u.mem.kaltsTravel)return refuse('action');
  if(!(u.mem.kaltsMoveCharges>0))return refuse('charges');
  const target=b.allyUnits.find(t=>t.ownerId===playerId&&t.uid===a.targetUid&&t.kind==='op');
  if(!live(target)||target===u||u.mem.kaltsMoveEligible?.get(target.id)!==target.deploySeq||!bodyInKeys(target,u.rangeKeys))return refuse('target');
  const {row:r,col:c}=a;
  if(!Number.isInteger(r)||!Number.isInteger(c)||!b.grid.inRect(r,c)||!u.rangeKeys.includes(r*COLS+c)||target.tileR===r&&target.tileC===c)return refuse('tile');
  if(!b.grid.canStand(r,c,{ranged:target.def.position!=='MELEE'})||b.isReservedTile(r,c))return refuse('tile');
  if(!b.moveRedeploy(target,r,c,{clearSp:true}))return refuse('deploy');
  u.mem.kaltsMoveCharges--;u.mem.kaltsMoveEligible.delete(target.id);
  return {ok:true,unitId:target.id,tile:r*COLS+c};
 }
 if(a.kind!=='wang.place'||!u.mem.wang)return refuse('action');
 const {row:r,col:c}=a,st=u.mem.wang;
 if(!Number.isInteger(r)||!Number.isInteger(c)||!b.grid.inRect(r,c))return refuse('tile');
 const def=b.tokenDef(STONE,u);if(!def)return refuse('token');
 const enemyHere=b.enemies.some(e=>e.alive&&!e.removed&&!e.isFlying&&Math.round(e.y)===r&&Math.round(e.x)===c);
 const s3=u.skill?.id==='skchr_wang_3'&&u.skill.active&&u.rangeKeys.includes(r*COLS+c)&&b.grid.isLow(r,c);
 // S3 explicitly permits manual pieces on enemy-occupied ground, including
 // unbuildable ground. It never overrides allied occupancy or high terrain.
 if(b.isReservedTile(r,c)||!b.grid.canStand(r,c,{ranged:def.position!=='MELEE'})&&!(s3&&enemyHere))return refuse('tile');
 if(enemyHere&&!s3)return refuse('enemy');
 if(st.stock<=0)return refuse('stock');
 const limit=def.deployLimit??def.stats.deployLimit??def.raw?.deployLimit;
 if(Number.isFinite(limit)&&b.allyUnits.filter(t=>live(t)&&t.ownerUnit===u&&t.defId===STONE).length>=limit)return refuse('limit');
 if(b.time+1e-9<(st.nextPlaceAt||0))return refuse('cooldown');
 const ps=b.getPlayer(playerId),cost=Math.max(0,def.stats.cost||0);
 if(!ps||ps.dp+1e-9<cost)return refuse('dp');
 ps.dp-=cost;
 const token=b.spawnToken(u,STONE,r,c);
 if(!token){ps.dp+=cost;return refuse('deploy');}
 token.mem.wangManual=true;
 st.nextPlaceAt=b.time+Math.max(0,def.stats.respawnTime||0);
 // Replacing a virtual follower with a manual piece must not leave a duplicate
 // link node until the next pulse. The new token's deploy hook already made it.
 for(const n of st.nodes)if(n!==token.mem.wangNode&&!n.token&&n.r===r&&n.c===c)n.active=false;
 st.nodes=st.nodes.filter(n=>n.active);
 return {ok:true,unitId:token.id,tile:r*COLS+c};
}
