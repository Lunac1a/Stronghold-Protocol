// Five custom recruits. Numbers are taken from the selected official skill/talent blackboards.
import { COLS,PROJECTILE_SPEEDS } from '../../constants.js';
import { bodyInKeys, bodyInRadius } from '../../body.js';
import { absoluteRangeKeys,sortEnemyTargets } from '../../targeting.js';
import { addShieldLayer,weaknessRetype } from '../items/battle.js';
import {beginKaltsTravel} from '../../customActions.js';

const live = u => !!(u?.alive && u.deployed && !u.removed);
const tb = (c, i) => c.talents?.[i]?.bb || {};
const selected = (c, d) => c.skill?.skillId || d.skill?.id;
const range = d => d.skill?.rangeGrid ? { rangeGrid: d.skill.rangeGrid } : undefined;
const duration = d => d.skill?.duration || 0;
const bind = (b, u, name, fn, priority = 0) => b.on(name, fn, { owner: u, priority });
const pulse = (b, u, iv, fn) => b.every(iv, () => { if (live(u)) fn(); }, { owner: u });
const damage = (b, u, e, amount, type = 'arts', tags = [], extra = {}) => b.dealDamage(u, e, { amount, type, tags, isSkill: true, ...extra });
const foes = (b, u, air = true) => b.enemiesInKeys(u.rangeKeys, u, { canHitFly: air });
const stat = (b, u, key, mods, flags) => b.addBuff(u, { key, mods, flags, persist: true, allowDead: true });
const batMods = (c, delta) => delta ? { batPct: delta / c.stats.bat } : {};
const nearest = (list, p) => [...list].sort((a, b) => Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y) || a.spawnSeq-b.spawnSeq);
function freeTile(b, u, keys = u.rangeKeys, ranged = false, at = u, preferLower = false) {
  return keys.map(k => [Math.floor(k/COLS), k%COLS]).filter(([r,c]) => !b.isReservedTile(r,c) && b.grid.canStand(r,c,{ranged}))
    .sort((a,z) => Math.hypot(a[1]-at.x,a[0]-at.y)-Math.hypot(z[1]-at.x,z[0]-at.y) || (preferLower?a[0]-z[0]:z[0]-a[0]) || a[1]-z[1])[0];
}

function chen(bb, c, d) {
  const t1=tb(c,0), t2=tb(c,1);
  return {
    skills: {
      skchr_chen3_1: { kind:'duration', mods:{atkPct:bb.atk}, attack:{hits:2, onEachHit({battle,unit,target,skill}) {
        battle.applyStatus(target,'silence',{duration:skill.timeLeft,source:unit,buffKey:`chen3:silence:${unit.id}`});
      }},onEnd({battle:b,unit:u}){
        for(const e of b.enemies)b.removeBuff(e,`chen3:silence:${u.id}`);
      } },
      skchr_chen3_2: { kind:'duration',targeting:{...range(d),canHitFly:true},attack:{noAttack:true}, flags:{invulnerable:true,untargetable:true,noBlock:true,noSp:true}, onStart({battle:b,unit:u,skill:s}) {
        const home=[u.tileR,u.tileC], seq=u.deploySeq;
        let remaining=10,target=nearest(foes(b,u),u)[0],finishing=false;
        b.releaseBlocked(u);
        const transfer=()=>{
          const all=b.enemies.filter(e=>e.alive&&!e.hidden&&e!==target);
          const nearby=nearest(all.filter(e=>bodyInRadius(e,target?.x??u.x,target?.y??u.y,1.7)),target||u);
          target=nearby[0]||nearest(foes(b,u),target||u)[0];
          if(target){remaining++;s.extend(0.4);}return target;
        };
        const finish=()=>{
          if(finishing)return;finishing=true;
          // Skill_2_Disappear is five frames. Start_2 contains the subsequent
          // redeployment animation; the six-second buff begins at deployment.
          b.after(5/30,()=>{
            if (!live(u) || u.deploySeq!==seq || !s.active) return;
            s.end('slashes');
            let moved=false;
            if(target?.alive&&b.grid.canStand(Math.round(target.y),Math.round(target.x)))moved=b.moveRedeploy(u,Math.round(target.y),Math.round(target.x),{clearSp:true});
            if(!moved)b.moveRedeploy(u,...home,{clearSp:true});
            b.addBuff(u,{key:'chen3:afterDash',duration:duration(d),flags:{noSp:true},mods:{atkPct:bb['chen3_s2[respawn_buff].atk'],dodgePhys:bb['chen3_s2[respawn_buff].prob'],dodgeArts:bb['chen3_s2[respawn_buff].prob']}});
          },{owner:u});
        };
        const slash=()=>{
          if(!live(u)||u.deploySeq!==seq||!s.active) return;
          if(target&&!target.alive&&!transfer())return finish();
          if(!target || remaining--<=0) return finish();
          damage(b,u,target,u.s.atk*bb.atk_scale,'arts',['chen3:slash']);
          b.fx('extraAttack',{x:target.x,y:target.y,id:u.id});
          if(!target.alive&&!transfer())return finish();
          if(remaining>0)b.after(0.4,slash,{owner:u});else finish();
        };
        b.after(17/30,slash,{owner:u});
      } },
      skchr_chen3_3: {kind:'duration',targeting:{...range(d),maxTargets:bb['attack@max_target'],canHitFly:false},
        attack:{hits:3,atkScale:bb['attack@atk_scale'],dmgType:'arts'},
        onStart({battle:b,unit:u}) {
          // PRTS: 1.5 tiles/s, radius 1.3, terrain-driven clockwise quarter
          // turns; a target can be hit again after a turn, not on every frame.
          const st=u.mem.chenWave={v:[...u.fwd],hit:new Set(),x:u.x,y:u.y,atk:u.s.atk,turns:0,active:true};
          const blocked=()=>{
            // Resolve a probe exactly on a tile boundary toward its travel
            // direction; Math.round alone postpones left/down turns by a frame.
            const tileAt=(p,v)=>v<0?Math.ceil(p-0.5-1e-9):v>0?Math.floor(p+0.5+1e-9):Math.round(p);
            const r=tileAt(st.y+st.v[0]*0.25,st.v[0]),c=tileAt(st.x+st.v[1]*0.25,st.v[1]),tile=b.grid.tile(r,c);
            return !b.grid.inRect(r,c)||tile.height==='HIGH'||tile.special==='start'||tile.special==='end';
          };
          const wave=b.every(1/30,()=>{
            if(!live(u)||!u.skill.active||u.skill.id!=='skchr_chen3_3'){st.active=false;wave.cancel();return;}
            if(blocked()){
              st.v=[-st.v[1],st.v[0]];st.turns++;st.hit.clear();
            }
            if(!blocked()){st.x+=st.v[1]*1.5/30;st.y+=st.v[0]*1.5/30;}
            for(const e of b.foesInRadius(st.x,st.y,1.3,true)) if(!st.hit.has(e.id)) {
              // PRTS classifies the precomputed wave as ordinary damage without
              // an attack delivery path, despite originating from skill activation.
              st.hit.add(e.id); damage(b,u,e,Math.max(e.hp*bb.hp_ratio,st.atk*bb.projectile_min_atk_scale),'arts',['chen3:wave'],{isSkill:false});
            }
            if(b.tickCount%3===0)b.fx('zone',{x:st.x,y:st.y,r:1.3,duration:0.12,src:'chen3:wave'});
          },{owner:u});
        }},
    },
    install(b,u) {
      stat(b,u,'chen3:insight',{atkPct:t1.atk||0,aspd:t1.attack_speed||0});
      bind(b,u,'hit',ctx=>{
        if(ctx.source===u)weaknessRetype(ctx.dmg,u,ctx.target);
      },-10);
      if(t2.stack_time) {
        let lastHit=b.time,lastHeal=b.time;
        bind(b,u,'damaged',ctx=>{if(ctx.target===u&&ctx.amount>0)lastHit=b.time;});
        pulse(b,u,0.1,()=>{
          if(b.time-Math.max(lastHit,lastHeal)<t2.stack_time)return;
          lastHeal=b.time;
          // The game data stores an exclusive upper bound (161 means at most 160%).
          const healPercent=t2.heal_atk_scale_min+b.rng.int(t2.heal_atk_scale_max-t2.heal_atk_scale_min);
          b.heal(u,u,u.s.atk*healPercent/100,{self:true});
          b.addBuff(u,{key:'chen3:evade',flags:{chenEvade:true}});
        });
        // One evasion applies to physical/arts attacks, not true damage or HP loss.
        bind(b,u,'hit',ctx=>{
          if(ctx.target===u&&ctx.dmg.isAttack&&['phys','arts'].includes(ctx.dmg.type)&&u.findBuff('chen3:evade')) {
            ctx.dmg.amount=0;b.removeBuff(u,'chen3:evade');b.fx('dodge',{x:u.x,y:u.y,id:u.id});
          }
        },-1000);
      }
    },
  };
}

const SOUL='token_10035_wisdel_wward';
function spawnSouls(b,u,n,initialSp=[]) {
  for(let i=0;i<n;i++) {
    if(b.allyUnits.filter(t=>live(t)&&t.defId===SOUL&&t.ownerUnit===u).length>=3)return;
    const p=freeTile(b,u,u.rangeKeys,b.tokenDef(SOUL,u)?.position!=='MELEE',u,true);if(!p)return;
    const t=b.spawnToken(u,SOUL,...p);if(t&&initialSp[i])t.skill.setSpTotal(initialSp[i]);
  }
}
function wisdel(bb,c,d) {
  const t=tb(c,0), sid=selected(c,d);
  const shadow=(e,u)=>e.mem[`wisdel:${u.id}`];
  const unlock=(b,u)=>{
    const e=b.enemies.find(e=>e.id===u.mem.wisLock?.target);
    if(e?.mem.wisBlastLocks)delete e.mem.wisBlastLocks[u.id];
    u.mem.wisLock=null;
  };
  return {
    skills:{
      skchr_wisdel_1:{kind:'instant',attack:{splashRadius:1.2}},
      skchr_wisdel_2:{kind:'duration',mods:{atkPct:bb.atk,...batMods(c,bb.base_attack_time)},targeting:{maxTargets:3},
        onStart({unit:u,skill:s}){u.mem.wisOverload=false;s.spec.targeting.maxTargets=3;s.spec.attack={hits:1,atkScale:1};},
        onTick({battle:b,unit:u,skill:s}){
          const overload=s.timeLeft<=duration(d)/2;
          s.spec.targeting.maxTargets=overload?1:3;
          s.spec.attack=overload?{hits:1,atkScale:bb['attack@atk_scale_ol']}:{hits:1,atkScale:1};
          u.mem.wisOverload=overload;
        },onEnd({unit:u}){u.mem.wisOverload=false;}},
      skchr_wisdel_3:{kind:'ammo',ammo:bb['attack@trigger_time'],mods:{atkPct:bb.atk,...batMods(c,bb.base_attack_time)},
        targeting:{canHitFly:true},
        attack:{snapshotAtk:true,groundOnly:false,atkScale:bb['attack@atk_scale_3'],splashRadius:2.5},onStart({battle:b,unit:u}){spawnSouls(b,u,2,[3,0]);}},
    },
    trait:{onEachHit(b,u,e,h){if(h.kind==='main')e.mem[`wisdel:${u.id}`]=true;},afterHit(b,u,e,h){
      const s1=h.isSkill&&sid==='skchr_wisdel_1',s3=h.isSkill&&sid==='skchr_wisdel_3';
      const scale=s1?bb.append_atk_scale:s3?0.5*bb['attack@atk_scale_3']:0.5;
      const r=s3?2.5:s1?1.2:0.9,atk=h.atk??u.s.atk;
      const aftershocks=Math.max(1,(u.profile.shockTimes||2)-1)+(s1?2:0),detonated=new Set();
      // User-provided frame sequence: main hit, explosion +4f, shocks +8f/+12f.
      // Register detonation phases first so simultaneous explosions precede damage.
      for(let i=1;i<=aftershocks;i++)b.after(i*4/30,()=>{
        for(const target of b.foesInRadius(h.x,h.y,r,true))if(s3||!target.isFlying)
          b.emit('wisdel:detonate',{source:u,target,isSkill:h.isSkill,guaranteed:s3,atk,detonated});
      });
      for(let i=1;i<=aftershocks;i++)b.after((i+1)*4/30,()=>{
        for(const z of b.foesInRadius(h.x,h.y,r,true))if(s3||!z.isFlying){
          damage(b,u,z,atk*scale*(z===e?(t['attack@main_atk_scale']||1):1),'phys',['aftershock'],{isSplash:true,isSkill:h.isSkill});
          if(s1)b.applyStatus(z,'stun',{duration:bb.stun_duration,source:u});
        }
      });
    }},
    install(b,u){
      if(sid==='skchr_wisdel_3'){
        bind(b,u,'beforeAttack',ctx=>{
          if(ctx.attacker!==u||!ctx.isSkill)return;
          const es=foes(b,u,true);sortEnemyTargets(b,u,es,ctx.profile.priority);
          const target=es.find(e=>Object.values(e.mem.wisBlastLocks||{}).some(until=>until>b.time))||ctx.targets[0];
          if(!target)return;
          ctx.targets=[target,...ctx.targets.filter(e=>e!==target)].slice(0,ctx.targets.length);unlock(b,u);
          // Real Skill_3_Loop: OnAttack at 16/30, OnAttackFinished at 45/30.
          // The engine launches immediately; retain only the post-launch part,
          // scaled by the attack clip's playback speed (5 s at base ASPD).
          const until=b.time+(29/30)*u.s.interval/5;
          (target.mem.wisBlastLocks||={})[u.id]=until;
          u.mem.wisLock={target:target.id,until,seq:u.deploySeq};
        });
        pulse(b,u,1/30,()=>{
          const lock=u.mem.wisLock;
          if(lock&&(b.time>=lock.until||!u.canAct||u.s.flags.disarm||u.deploySeq!==lock.seq))unlock(b,u);
        });
        bind(b,u,'death',ctx=>{if(ctx.unit===u)unlock(b,u);});
      }
      bind(b,u,'hit',ctx=>{
        if(ctx.source!==u)return;
        if(ctx.dmg.isAttack&&!ctx.dmg.isSplash)ctx.dmg.amount*=t['attack@main_atk_scale']||1;
        if(!ctx.dmg.tags?.includes('aftershock'))return;
        if(sid==='skchr_wisdel_1'&&ctx.dmg.isSkill)b.applyStatus(ctx.target,'stun',{duration:bb.stun_duration,source:u});
      });
      bind(b,u,'wisdel:detonate',ctx=>{
        const key=`${u.id}:${ctx.target.id}`;
        if(!shadow(ctx.target,u)||ctx.detonated?.has(key))return;
        const p=ctx.guaranteed?1:t['attack@prob'];
        if(!b.rng.chance(p||0))return;
        ctx.detonated?.add(key);
        for(const e of b.foesInRadius(ctx.target.x,ctx.target.y,t['attack@range_radius']||1.1,true)) {
          damage(b,u,e,(ctx.source===u?ctx.atk:u.s.atk)*t['attack@bomb_atk_scale'],'phys',['wisdel:explosion']);
          b.applyStatus(e,'stun',{duration:t['attack@stun'],source:u});
        }
        b.fx('aoe',{x:ctx.target.x,y:ctx.target.y,r:t['attack@range_radius']||1.1,id:u.id});
      });
      bind(b,u,'beforeAttack',ctx=>{if(ctx.attacker===u&&u.mem.wisOverload){const es=foes(b,u,false);if(es.length)ctx.targets=Array.from({length:4},()=>b.rng.pick(es));}});
      bind(b,u,'death',ctx=>{if(ctx.unit===u)for(const e of b.enemies)delete e.mem[`wisdel:${u.id}`];});
      bind(b,u,'deploy',ctx=>{
        if(ctx.unit!==u||ctx.move||!c.talents?.some(t=>t.tokenKey===SOUL))return;
        // PRTS: the talent summon follows deployment animation completion.
        // Both original Front/Back Start clips last 30 frames at 30 Hz.
        const seq=u.deploySeq;
        b.after(1,()=>{if(live(u)&&u.deploySeq===seq)spawnSouls(b,u,1);},{owner:u});
      });
      pulse(b,u,0.2,()=>{
        const near=b.allyUnits.some(t=>live(t)&&t.defId===SOUL&&t.ownerUnit===u&&t.mem.wisCamoGranted&&Math.hypot(t.x-u.x,t.y-u.y)<=1.8);
        if(near)b.addBuff(u,{key:'wisdel:camo',duration:0.3,flags:{camou:true}});
      });
    },
  };
}

function kalts(bb,c,d) {
  const t1=tb(c,0),t2=tb(c,1);
  const enemies=(b,u)=>sortEnemyTargets(b,u,[...new Set([...foes(b,u),...b.blockedTargets(u,{canHitFly:true})])]);
  const enter=(b,u,a)=>{
    addShieldLayer(b,a,'kalts2:shield',1);
    const rhodes=a.def.raw?.nationId==='rhodes'||a.def.raw?.teamId==='rhodes'||a.def.raw?.groupId==='rhodes';
    b.addBuff(a,{key:'kalts2:recovery',duration:t2.buff_duration,mods:{hpRegen:t2.hp_recovery_per_sec*(rhodes?t2.rhodes_bonus:1)}});
  };
  return {
    trait:{attack:'ranged',dmgType:'heal',heal:{mode:'single'},projectile:'none',
      // Selection still respects healing bans; only the original Kal'tsit summon is exempt.
      // Once an attack/area heal lands, Esperanta's healing ignores the healing ban.
      healIgnoresBan:true,healBanException:a=>a.defId==='token_10002_kalts_mon3tr'},
    skills:{
      skchr_kalts2_1:{kind:'duration',heal:true,mods:{atkPct:bb.atk,aspd:bb.attack_speed},onTick({battle:b,unit:u}){
        for(const a of b.allyUnits)if(live(a)&&a!==u&&a.s.flags.liftoff)b.addBuff(a,{key:'kalts2:blockRange',duration:0.1,mods:{blockRadiusScale:bb['attack@block_radius_scale']||0.23}});
      }},
      skchr_kalts2_2:{kind:'ammo',trigger:'SEARCH',heal:false,ammo:bb['attack@trigger_time'],mods:{atkPct:bb.atk},targeting:{...range(d),canHitFly:true},
        attack:{permanentAttack:true,canAttack:(b,u)=>enemies(b,u).length>0||b.injuredAlliesInKeys(u.rangeKeys,u).length>0,dmgType:'true',heal:null,atkScale:0,projectile:'bolt',customAttack(b,u,targets){
          const attack=u.s.atk,impact=u.skill.spec.attack.onHit;
          for(const target of targets){
            b._ev(['atk',u.id,target.id,'bolt']);
            b.addProjectile({from:u,target,source:u,speed:PROJECTILE_SPEEDS.bolt,visual:'bolt',onHit:ctx=>{
              if(ctx.target)impact({battle:b,unit:u,target:ctx.target,attack});
            }});
          }
        },onHit({battle:b,unit:u,target:e,attack=u.s.atk}){
          if(!e)return;
          const friendly=e.side==='ally';
          const heal=()=>{for(const a of b.alliesFor(u))if(bodyInRadius(a,e.x,e.y,1.5))b.heal(u,a,attack*bb['attack@heal_scale']);};
          const hit=()=>{for(const target of b.foesInRadius(e.x,e.y,1.5,true)) {
            b.dealDamage(u,target,{amount:attack*bb['attack@atk_scale'],type:'true',tags:['kalts2:medical'],isSkill:false});
            if(!friendly)b.applyStatus(target,'sluggish',{duration:bb['attack@sluggish'],source:u});
          }};
          if(friendly){heal();hit();}else{hit();heal();}
          b.fx('healAoe',{x:e.x,y:e.y,r:1.5,id:u.id});
        }}},
      skchr_kalts2_3:{kind:'duration',heal:true,mods:{atkPct:bb.atk,...batMods(c,bb.base_attack_time)},attack:{heal:{mode:'multi',count:2}},
        onStart({battle:b,unit:u}){
          u.mem.kaltsAnchorAvailable=true;
          const anchor=b.allyUnits.find(t=>t.ownerUnit===u&&t.defId==='token_10068_kalts2_mtship'&&!t.removed);
          if(anchor){
            beginKaltsTravel(b,u,anchor);
          }
        },onTick({battle:b,unit:u,skill:s,dt}){
          const travel=u.mem.kaltsTravel;if(!travel)return;
          s.extend(dt);
          const [r,c]=travel.pos,dx=c-u.x,dy=r-u.y,len=Math.hypot(dx,dy),step=Math.min(len,3.5*dt);
          if(len>1e-9){u.x+=dx/len*step;u.y+=dy/len*step;}
          for(const a of b.allies())if(a!==u&&a.kind==='op'&&travel.touched.get(a.id)!==a.deploySeq&&bodyInRadius(a,u.x,u.y,2.2)){
            travel.touched.set(a.id,a.deploySeq);if(t2.buff_duration)enter(b,u,a);
          }
          if(len<=step+1e-9){
            u.mem.kaltsTravel=null;b.removeBuff(u,'kalts2:travel');
            if(!b.moveRedeploy(u,r,c)){u.x=u.tileC;u.y=u.tileR;return;}
            u.mem.kaltsMoveCharges=2;
            u.mem.kaltsMoveEligible=new Map(b.alliesFor(u,u.ownerId).filter(a=>a!==u&&a.kind==='op'&&bodyInKeys(a,u.rangeKeys)).map(a=>[a.id,a.deploySeq]));
            b.fx('teleport',{x:u.x,y:u.y,id:u.id});
          }
        },onEnd({battle:b,unit:u}){
          if(u.mem.kaltsTravel){u.x=u.tileC;u.y=u.tileR;u.mem.kaltsTravel=null;}
          b.removeBuff(u,'kalts2:travel');
          u.mem.kaltsMoveCharges=0;u.mem.kaltsMoveEligible?.clear();
          u.mem.kaltsAnchorAvailable=false;
        }},
    },
    install(b,u){
      stat(b,u,'kalts2:watch',{hpPct:t1.max_hp||0,defPct:t1.def||0,blockCnt:t1.block_cnt||0,blockRadiusScale:t1.block_radius_scale||0}, {liftoff:true,blockFly:true});
      if(selected(c,d)==='skchr_kalts2_2')pulse(b,u,1/30,()=>{
        const s=u.skill;
        if(!s.active&&s.ready&&!s.opCooling&&u.canAct&&!u.s.flags.silence&&b.injuredAlliesInKeys(u.baseRangeKeys||u.rangeKeys,u).length)s.activate('SEARCH');
      });
      if(t2.buff_duration){
        const inside=new Map();
        const refresh=()=>{
          const current=new Map();
          // This talent explicitly ignores friendly isolation and covers allied operators of every participant.
          for(const a of b.allies())if(a!==u&&a.kind==='op'&&bodyInKeys(a,u.rangeKeys)){
            current.set(a.id,a.deploySeq);if(inside.get(a.id)===a.deploySeq)continue;
            enter(b,u,a);
          }
          inside.clear();for(const [id,seq] of current)inside.set(id,seq);
        };
        bind(b,u,'deploy',ctx=>{if(ctx.unit===u&&!ctx.move)inside.clear();if(live(u))refresh();});
        pulse(b,u,1/30,refresh);
      }
      bind(b,u,'beforeAttack',ctx=>{
        if(ctx.attacker!==u||!u.skill.active||selected(c,d)!=='skchr_kalts2_2')return;
        const es=enemies(b,u);if(es.length)ctx.targets=[es[0]];
        else ctx.targets=b.injuredAlliesInKeys(u.rangeKeys,u).slice(0,1);
      });
    },
  };
}

const STONE='token_10064_wang_stone1';
const CROSS=[[1,0],[0,1],[-1,0],[0,-1]];
function wangState(u) { return u.mem.wang || (u.mem.wang={nodes:[],stock:0,maxStock:7,followers:9,ready:false}); }
function addFollower(b,u,r,c) {
  const st=wangState(u);
  if(st.nodes.filter(n=>n.active&&!n.token).length>=st.followers || st.nodes.some(n=>n.active&&n.r===r&&n.c===c) || !b.grid.inRect(r,c)||(!b.grid.groundPassable(r,c)&&!b.grid.canStand(r,c,{ranged:true})))return false;
  if(b.allyUnits.some(t=>live(t)&&t.tileR===r&&t.tileC===c))return false;
  st.nodes.push({r,c,active:true,token:null});
  b.fx('wangStone',{x:c,y:r,id:u.id});return true;
}
function followerPriority(b,p) {
  const enemy=b.enemies.some(e=>e.alive&&!e.removed&&Math.round(e.y)===p.r&&Math.round(e.x)===p.c);
  const terrain=!b.grid.canStand(p.r,p.c,{ranged:true})?0:b.grid.isLow(p.r,p.c)?1:2;
  return [enemy?0:1,terrain];
}
function compareFollowerPositions(b,a,z) {
  const ap=followerPriority(b,a),zp=followerPriority(b,z);
  return ap[0]-zp[0]||ap[1]-zp[1]||a.order-z.order;
}
function followStone(b,u,r,c) {
  const s3=u.skill.active&&u.skill.id==='skchr_wang_3'&&u.rangeKeys.includes(r*COLS+c);
  const choices=CROSS.map(([dr,dc],order)=>({r:r+dr,c:c+dc,order})).filter(p=>b.grid.inRect(p.r,p.c));
  choices.sort((a,z)=>compareFollowerPositions(b,a,z));
  const place=()=>{choices.sort((a,z)=>compareFollowerPositions(b,a,z));for(const p of choices)if(addFollower(b,u,p.r,p.c))return true;return false;};
  // The talent's first follower is free. S3 adds up to three further pieces,
  // one every nine frames, only for a manual piece inside the expanded range.
  const made=place()?1:0,skill=u.skill,seq=u.deploySeq,activation=skill.activations,st=wangState(u);
  if(s3)st.pendingFollowers=(st.pendingFollowers||0)+3;
  if(s3)for(let i=1;i<=3;i++)b.after(i*9/30-1e-9,()=>{
    if(u.deploySeq!==seq||skill.activations!==activation)return;
    st.pendingFollowers=Math.max(0,(st.pendingFollowers||0)-1);
    if(!live(u)||u.skill!==skill||!skill.active||skill.ammoLeft<=0)return;
    if(place())skill.ammoLeft--;
  },{owner:u});
  return made;
}

function lineOf(st,n,dr,dc) {
  const line=[n];
  for(const sign of [-1,1])for(let i=1;;i++){
    const x=st.nodes.find(v=>v.active&&v.r===n.r+dr*i*sign&&v.c===n.c+dc*i*sign);
    if(!x)break;line.push(x);
  }
  return line;
}
function triggerStone(b,u,n,bb,sid,talent) {
  if(!n.activation)return;
  const s3=sid==='skchr_wang_3';
  const keys=s3?absoluteRangeKeys([[0,0],[0,1],[0,-1],[1,0],[-1,0],[0,2],[0,-2],[2,0],[-2,0]],n.r,n.c,'RIGHT',0):[n.r*COLS+n.c];
  const entrants=b.enemiesInKeys(keys,n.token||u,{canHitFly:true});
  if(!entrants.length)return;
  const layers=n.activation.layers;
  const multiplier=1+layers*(talent['attack@per_atk_scale']||0),penetration=layers*(talent['attack@per_magic_resist_penetrate_fixed']||0);
  const src=n.token||u,attack=u.s.atk;
  n.active=false;
  if(sid==='skchr_wang_1'){
    for(const e of entrants){
      b.applyStatus(e,'sluggish',{duration:bb['attack@sluggish'],source:u});
      let left=bb['attack@sluggish'];
      const dot=b.every(0.5,()=>{if(!e.alive||left<=0){dot.cancel();return;}damage(b,u,e,attack*bb['attack@atk_scale']*multiplier*Math.min(0.5,left),'arts',['wang:dot'],{resIgnoreFlat:penetration,sourceless:true});left-=0.5;});
    }
  }else{
    let hitKeys=keys;
    if(sid==='skchr_wang_2'){
      hitKeys=[...new Set([...(n.activation.horizontal?Array.from({length:7},(_,i)=>n.r*COLS+n.c+i-3):[]),
        ...(n.activation.vertical?Array.from({length:7},(_,i)=>(n.r+i-3)*COLS+n.c):[])])];
    }
    for(const e of b.enemiesInKeys(hitKeys,src,{canHitFly:true})){
      damage(b,src,e,attack*(s3?bb.atk_scale:bb['attack@atk_scale'])*multiplier,'arts',['wang:stone',`wang:piece:${n.r}:${n.c}`],{resIgnoreFlat:penetration});
      if(sid==='skchr_wang_2')b.addBuff(e,{key:'wang:slow',source:src,duration:bb['attack@duration'],
        mods:{moveMul:Math.max(0,1+bb['attack@move_speed']),moveSpeedFloor:0.1},refresh:'independent',maxStacks:Infinity,status:'slow',visible:true});
    }
  }
  if(!n.token)b.fx('wangStoneEnd',{x:n.c,y:n.r,id:u.id});
  b.fx('aoe',{x:n.c,y:n.r,r:s3?2:0.5,id:u.id});
  if(n.token)b.retreat(n.token,{reason:'expired'});
}
function wang(bb,c,d){
  const t1=tb(c,0),t2=tb(c,1),sid=selected(c,d);
  const replenish=({unit:u},n)=>{const st=wangState(u);st.stock=Math.min(st.maxStock,st.stock+n);};
  return {skills:{
    skchr_wang_1:{kind:'instant',trigger:'SP_FULL',onStart(ctx){replenish(ctx,bb.cnt);}},
    skchr_wang_2:{kind:'instant',trigger:'SP_FULL',onStart(ctx){replenish(ctx,bb.cnt);}},
    skchr_wang_3:{kind:'ammo',trigger:'SP_FULL',ammo:bb.trigger_time,attack:{noAttack:true},targeting:range(d),onStart({battle:b,unit:u}){
      const st=wangState(u),overflow=Math.max(0,st.stock+bb.cnt-st.maxStock);st.stock=Math.min(st.maxStock,st.stock+bb.cnt);
      const tiles=u.rangeKeys.map((k,order)=>({r:Math.floor(k/COLS),c:k%COLS,order}));
      tiles.sort((a,z)=>compareFollowerPositions(b,a,z));
      // Only inventory overflow is placed automatically. These virtual followers
      // do not pay DP, consume stock/ammunition or recursively generate followers.
      let placed=0;for(const {r,c}of tiles)if(placed<overflow&&addFollower(b,u,r,c))placed++;
    },onTick({unit:u,skill:s}){if(wangState(u).stock===0&&!wangState(u).pendingFollowers)s.end('empty');},
    onEnd({unit:u,ammoLeft,reason}){wangState(u).pendingFollowers=0;if(reason!=='death'){const st=wangState(u);st.stock=Math.min(st.maxStock,st.stock+(ammoLeft||0));}}},
  },install(b,u){
    const st=wangState(u);st.stock=t1.cnt||6;st.maxStock=(t1.cnt||6)+1;st.followers=t1['attack@max_spawn_cnt']||9;
    bind(b,u,'deploy',ctx=>{
      if(ctx.unit!==u||ctx.move)return;
      st.stock=t1.cnt||6;st.nodes=[];st.ready=true;st.nextPlaceAt=0;
    });
    pulse(b,u,0.1,()=>{
      for(const n of st.nodes)if(!n.token&&b.allyUnits.some(a=>live(a)&&a.tileR===n.r&&a.tileC===n.c)){n.active=false;b.fx('wangStoneEnd',{x:n.c,y:n.r,id:u.id});}
      st.nodes=st.nodes.filter(n=>n.active);
      if(st.stock>=st.maxStock)b.addBuff(u,{key:'wang:stockFull',duration:0.15,flags:{noSp:true}});
      else b.removeBuff(u,'wang:stockFull');
      // Activation and its talent layers are captured before any piece triggers.
      // Removing one piece must not retroactively change another's activation.
      for(const n of st.nodes){
        const horizontal=lineOf(st,n,0,1),vertical=lineOf(st,n,1,0),count=Math.max(horizontal.length,vertical.length);
        if(count>=2){
          n.activation||={layers:Math.min(count,t2['attack@max_trigger_cnt']||0),horizontal:false,vertical:false};
          n.activation.horizontal ||= horizontal.length>=2;
          n.activation.vertical ||= vertical.length>=2;
        }
      }
      for(const n of st.nodes) {
        if(!n.token&&b.allyUnits.some(a=>live(a)&&a.tileR===n.r&&a.tileC===n.c)){n.active=false;continue;}
        triggerStone(b,u,n,bb,sid,t2);
        if(n.active&&!n.token)b.fx('wangStone',{x:n.c,y:n.r,duration:0.15,id:u.id});
        if(n.active&&st.nodes.some(other=>other!==n&&other.active&&Math.abs(other.r-n.r)+Math.abs(other.c-n.c)===1))b.fx('wangLink',{x:n.c,y:n.r,tiles:lineOf(st,n,0,1).concat(lineOf(st,n,1,0)).map(v=>[v.r,v.c]),duration:0.15,id:u.id});
      }
      const pieces=b.allyUnits.filter(t=>t.ownerUnit===u&&t.defId===STONE&&!t.alive&&!t.removed&&b.time>=(t.mem.wangReadyAt||0));
      for(const t of pieces){
        const enemyHere=b.enemies.some(e=>e.alive&&!e.removed&&!e.isFlying&&Math.round(e.y)===t.tileR&&Math.round(e.x)===t.tileC);
        const s3=sid==='skchr_wang_3'&&u.skill.active&&u.rangeKeys.includes(t.tileR*COLS+t.tileC)&&b.grid.isLow(t.tileR,t.tileC);
        if(st.stock>0&&(!enemyHere||s3)&&(b.grid.canStand(t.tileR,t.tileC,{ranged:true})||s3&&enemyHere))b.redeploy(t,{free:false});
      }
    });
  }};
}

const MUJICA=new Set(['char_4182_oblvns','char_4183_mortis','char_4184_dolris','char_4185_amoris','char_4186_tmoris']);
const isMujica=u=>MUJICA.has(u?.def?.charId);
function feverState(b,u){
  b.customFever ||= new Map();
  if(!b.customFever.has(u.ownerId)){
    const f={value:0,until:0,held:new Map()};b.customFever.set(u.ownerId,f);
    b.on('skillStart',ctx=>{
      if(ctx.unit.ownerId===u.ownerId&&isMujica(ctx.unit)&&ctx.skill.manual&&ctx.reason!=='full'&&ctx.reason!=='fever')startFever(b,ctx.unit);
    });
    b.on('death',ctx=>{
      if(ctx.unit.ownerId===u.ownerId&&isMujica(ctx.unit))ctx.unit.mem.oblvnsFatal=false;
    });
    // The ensemble's state outlives the conductor. In particular permanent
    // retreat must not cancel duration restoration or deferred fatal retreats.
    b.every(1/30,()=>{
      if(!f.until)return;
      const teammates=b.allyUnits.filter(a=>a.ownerId===u.ownerId&&isMujica(a));
      if(f.until>b.time){
        for(const a of teammates)if(live(a)){
          const s=a.skill;
          if(s?.active&&s.kind==='duration')s.extend(1/30);
          else if(s&&!s.active&&!s.pending&&!s.noSkill&&s.kind!=='passive'&&s.kind!=='toggle'&&s.id!=='skchr_oblvns_2'&&!s.opCooling&&a.canAct&&!a.s.flags.silence)s.activate('fever',{free:true});
        }
        return;
      }
      for(const a of teammates){
        if(a.mem.oblvnsFatal){a.mem.oblvnsFatal=false;if(live(a))b.retreat(a);}
        if(a.skill?.active&&a.skill.kind==='duration'){
          if(f.held.has(a.id))a.skill.timeLeft=f.held.get(a.id);else a.skill.end('fever');
        }
      }
      f.until=0;f.held.clear();
    });
  }
  return b.customFever.get(u.ownerId);
}
function startFever(b,u){
  const st=feverState(b,u);if(st.value<450||st.until>b.time)return;
  st.value=0;st.until=b.time+20;st.held.clear();
  // onStart already marks the activating skill active; it was not running
  // before Fever and must end with Fever rather than receive a saved duration.
  for(const a of b.allyUnits)if(a!==u&&live(a)&&isMujica(a)&&a.ownerId===u.ownerId&&a.skill?.isTimed&&a.skill.active)st.held.set(a.id,a.skill.timeLeft);
  b.fx('fever',{x:u.x,y:u.y,id:u.id,duration:20});
}
function addNote(b,u,{scale=1,type='phys',speed=null,angle=null,pierce=false,priority=null,skill=false,motion=null}={}){
  const st=u.mem.oblvns;
  const blocked=u.blocking?.find(e=>e?.alive);
  const candidates=foes(b,u);if(priority)candidates.sort((a,z)=>z.s[priority]-a.s[priority]||a.spawnSeq-z.spawnSeq);
  const target=blocked||candidates[0]||null;
  if(angle===null)angle=(b.rng.int(4001)/100)-20;
  const v=blocked&&!motion&&speed===null ? [blocked.y-u.y,blocked.x-u.x] : u.fwd,a=angle*Math.PI/180;
  const dx=v[1]*Math.cos(a)-v[0]*Math.sin(a),dy=v[1]*Math.sin(a)+v[0]*Math.cos(a);
  const fullScale=u.blocking.length||((u.skill.active||u.skill.id==='skchr_oblvns_2')&&u.def.raw?.talents?.some(t=>/技能期间远程攻击不再降低攻击力/.test(t.desc||'')));
  const atk=u.s.atk*scale*(fullScale?1:0.8);
  const special=speed!==null;
  st.notes.push({atk,x:u.x,y:u.y,vx:dx,vy:dy,age:0,out:0,scale,type,
    speed:speed??(target?2:1.3),trackingSpeed:special?2.2*(speed/1.7):2,
    turn:!special&&!target?7/30:1/6,minFree:special?0.6:0.1,
    state:'free',nextUpdate:motion?.updateInterval??(special?0.2:0.4),updateInterval:motion?.updateInterval??(special?0.2:0.4),freeAge:0,sine:!special&&!target,
    originX:u.x,originY:u.y,axisX:dx,axisY:dy,sineSign:b.rng.chance(0.5)?1:-1,
    amplitude:0.3,acquireRadius:1,hitDuration:0,hitSpeed:0,hitRadius:0.4,
    ...motion,pierce,priority,skill,hit:new Set(),target});
}
function oblvns(bb,c,d){
  const t1=tb(c,0),t2=tb(c,1),sid=selected(c,d);
  const play=(b,u)=>{
    const st=u.mem.oblvns,f=feverState(b,u),fever=f.until>b.time;
    if(sid==='skchr_oblvns_3'&&u.skill.active){
      for(const type of ['phys','arts'])for(let i=0;i<2;i++)addNote(b,u,{scale:bb['attack@atk_scale'],type,priority:type==='phys'?'res':'def',skill:true,
        motion:{speed:0.8,trackingSpeed:1.3,turn:1/4,minFree:0.8,updateInterval:0.4,sine:true,amplitude:0.5}});
    }else if(sid==='skchr_oblvns_2'){
      for(let i=0;i<(fever?2:1);i++)addNote(b,u,{type:st.organ?'arts':'phys',pierce:!st.organ,
        motion:st.organ?{speed:0.7,trackingSpeed:1,turn:1/12,minFree:0.4,updateInterval:0.4,sine:true,amplitude:0.15}:
          {speed:1.9,trackingSpeed:3.5,turn:1/2,minFree:0.4,updateInterval:0.2,sine:true,amplitude:0.4,acquireRadius:0.8,hitDuration:0.5,hitSpeed:3,hitRadius:0.8}});
    }else addNote(b,u);
  };
  return {trait:{permanentAttack:true,customAttack(b,u){play(b,u);}},skills:{
    skchr_oblvns_1:{kind:'charges',trigger:'NEVER',onStart({battle:b,unit:u,reason}){
      for(let i=0;i<8;i++)addNote(b,u,{type:'arts',scale:bb[i?`atk_scale_${i+1}`:'atk_scale'],speed:1.7,angle:-13.125+i*3.75,skill:true});
      if(reason!=='full'&&reason!=='fever')startFever(b,u);
    }},
    skchr_oblvns_2:{kind:'instant',trigger:'NEVER',onStart({battle:b,unit:u}){
      const f=feverState(b,u);if(f.until>b.time)return;
      if(f.value>=450){startFever(b,u);return;}
      u.mem.oblvns.organ=!u.mem.oblvns.organ;
      b.addBuff(u,{key:'oblvns:instrument',persist:true,allowDead:true,mods:u.mem.oblvns.organ?{aspd:bb['attack@attack_speed']}:{atkPct:bb['attack@atk']}});
    }},
    skchr_oblvns_3:{kind:'duration',targeting:range(d),onStart({battle:b,unit:u}){startFever(b,u);}},
  },install(b,u){
    u.mem.oblvns={notes:[],organ:false,nextFeverCast:0};
    if(sid==='skchr_oblvns_2')stat(b,u,'oblvns:instrument',{atkPct:bb['attack@atk']});
    bind(b,u,'hit',ctx=>{
      if(ctx.source!==u||ctx.target.side!=='enemy')return;
      const f=feverState(b,u);if(f.until<=b.time)f.value=Math.min(450,f.value+(t2.cnt||3));
    });
    b.on('hit',ctx=>{
      if(ctx.source?.ownerId!==u.ownerId||!isMujica(ctx.source)||(!live(u)&&!u.mem.oblvns.notes.length))return;
      const count=Math.min(u.mem.oblvns.notes.length,t1.max_cnt||10);
      ctx.dmg.defIgnorePct+=count*(t1.def_penetrate_ratio||0);
      ctx.dmg.resIgnorePct+=count*(t1.magic_resist_penetrate_ratio||0);
    });
    bind(b,u,'fatal',ctx=>{
      if(sid!=='skchr_oblvns_3'||!u.skill.active||feverState(b,u).until<=b.time||!isMujica(ctx.unit)||ctx.unit.ownerId!==u.ownerId||ctx.prevented)return;
      ctx.prevented=true;ctx.unit.hp=1;ctx.unit.mem.oblvnsFatal=true;
    },-3000);
    bind(b,u,'death',ctx=>{
      if(ctx.unit===u)u.mem.oblvns.notes=u.mem.oblvns.notes.filter(n=>n.state==='tracking');
    });
    pulse(b,u,0.2,()=>{
      const st=u.mem.oblvns,f=feverState(b,u);
      const teammates=b.allyUnits.filter(a=>live(a)&&a.ownerId===u.ownerId&&isMujica(a));
      const original=new Set(absoluteRangeKeys(u.rangeGrid,u.tileR,u.tileC,u.dir,u.s.rangeExtend));
      const vision=a=>{
        const tg=a.skill?.active?a.skill.spec.targeting:null;
        return absoluteRangeKeys(tg?.rangeGrid||a.rangeGrid,a.tileR,a.tileC,a.dir,(tg?.noRangeExtend?0:a.s.rangeExtend)+(tg?.rangeExtend||0));
      };
      const keys=new Set();
      for(const a of teammates)if(a!==u){const base=vision(a);if(base.some(k=>original.has(k)))for(const k of base)keys.add(k);}
      b.setExtraRange(u,[...keys]);st.rangeKeys=[...u.rangeKeys];
      // Detail cards use a relative grid facing RIGHT. Include the composite
      // tiles so the displayed range matches the targets the engine can select.
      u.liveRangeGrid=u.rangeKeys.map(k=>{
        const dr=Math.floor(k/COLS)-u.tileR,dc=k%COLS-u.tileC;
        return u.dir==='UP'?[-dc,dr]:u.dir==='DOWN'?[dc,-dr]:u.dir==='LEFT'?[-dr,-dc]:[dr,dc];
      });
      for(const a of b.alliesFor(u,u.ownerId))if(bodyInKeys(a,u.rangeKeys))b.addBuff(a,{key:'oblvns:tempo',duration:0.3,mods:{aspd:t2.attack_speed||0}});
      if(f.until>b.time){
        // The owner-wide frame timer handles every eligible ensemble member.
      }else{
        if(sid==='skchr_oblvns_1'&&u.skill.ready&&(u.skill.charges>=u.skill.maxCharges||foes(b,u).length))u.skill.activate(u.skill.charges>=u.skill.maxCharges?'full':'auto');
        if(sid==='skchr_oblvns_2'&&u.skill.ready&&!u.skill.opCooling)u.skill.activate('auto');
      }
    });
    // Projectile lifetime is independent of the caster. Unit-owned recurring timers are
    // cancelled on permanent retreat, so this timer deliberately has its own lifetime.
    b.every(1/30,(_battle,timer)=>{
      const st=u.mem.oblvns,dt=1/30;
      if(!live(u)&&!st.notes.length){if(u.removed)timer.cancel();return;}
      const alive=[];
      for(const n of st.notes){
        n.age+=dt;
        n.freeAge+=dt;
        if(n.state==='hit'){
          n.hitLeft-=dt;if(n.hitLeft<-1e-9)continue;
          const norm=Math.hypot(n.vx,n.vy)||1;n.x+=n.vx/norm*n.hitSpeed*dt;n.y+=n.vy/norm*n.hitSpeed*dt;
          for(const e of b.foesInRadius(n.x,n.y,n.hitRadius,true))if(!n.hit.has(e.id)){n.hit.add(e.id);damage(b,u,e,n.atk,n.type,['oblvns:note'],{isSkill:n.skill});}
          b.fx('musicNote',{x:n.x,y:n.y,id:u.id,type:n.type});alive.push(n);continue;
        }
        const k=Math.round(n.y)*COLS+Math.round(n.x);
        n.out=(st.rangeKeys||u.rangeKeys).includes(k)||n.target?.alive?0:n.out+dt;
        if(n.out>(t1.delay||1))continue;
        if(n.age+1e-9>=n.nextUpdate){
          n.nextUpdate+=n.updateInterval;
          if(!n.target?.alive||n.hit.has(n.target.id)){
            const wasTracking=n.state==='tracking';n.target=null;n.state='free';
            if(wasTracking){n.originX=n.x;n.originY=n.y;n.axisX=n.vx;n.axisY=n.vy;n.freeAge=0;n.sineSign=b.rng.chance(0.5)?1:-1;}
            // Tracking projectiles retained after retreat cannot acquire new targets.
            if(!live(u))continue;
            const candidates=wasTracking?[]:b.foesInRadius(n.x,n.y,n.acquireRadius,true).filter(e=>!e.hidden&&!n.hit.has(e.id));
            candidates.sort((a,z)=>n.priority?(z.s[n.priority]-a.s[n.priority]||a.spawnSeq-z.spawnSeq):
              (Math.hypot(a.x-n.x,a.y-n.y)-Math.hypot(z.x-n.x,z.y-n.y)||a.spawnSeq-z.spawnSeq));
            n.target=candidates[0]||null;
          }
          if(n.target?.alive&&n.age>=n.minFree)n.state='tracking';
        }
        if(n.state==='tracking'&&n.target?.alive){const len=Math.hypot(n.target.x-n.x,n.target.y-n.y)||1;n.vx=n.vx*(1-n.turn)+(n.target.x-n.x)/len*n.turn;n.vy=n.vy*(1-n.turn)+(n.target.y-n.y)/len*n.turn;}
        const speed=n.state==='tracking'?n.trackingSpeed:n.speed;
        const norm=Math.hypot(n.vx,n.vy)||1;
        if(n.state==='free'&&n.sine){
          const distance=n.freeAge*speed,amplitude=n.amplitude*Math.min(3,1+Math.floor(distance/(2*Math.PI)));
          const offset=Math.sin(distance)*amplitude*n.sineSign;
          const axis=Math.hypot(n.axisX,n.axisY)||1;
          n.x=n.originX+n.axisX/axis*distance-n.axisY/axis*offset;
          n.y=n.originY+n.axisY/axis*distance+n.axisX/axis*offset;
        }else{n.x+=n.vx/norm*speed*dt;n.y+=n.vy/norm*speed*dt;}
        let consumed=false;
        for(const e of b.foesInRadius(n.x,n.y,0.4,true))if(!n.hit.has(e.id)&&n.state==='tracking'&&e===n.target){
          n.hit.add(e.id);damage(b,u,e,n.atk,n.type,['oblvns:note'],{isSkill:n.skill});
          if(n.hitDuration){n.state='hit';n.hitLeft=n.hitDuration;n.target=null;}else consumed=true;
          break;
        }
        if(Math.round(n.age/dt)%6===0)b.fx('musicNote',{x:n.x,y:n.y,id:u.id,type:n.type});
        if(!consumed)alive.push(n);
      }
      st.notes=alive;
    });
  }};
}

export const customTokenKits = {
  [STONE]:()=>({trait:{noAttack:true},install(b,t){
    stat(b,t,'wang:inert',{}, {untargetable:true,invulnerable:true});
    bind(b,t,'deploy',ctx=>{
      if(ctx.unit!==t)return;const u=t.ownerUnit;if(!u)return;
      const st=wangState(u);st.stock=Math.max(0,st.stock-1);
      const n={r:t.tileR,c:t.tileC,active:true,token:t};st.nodes.push(n);t.mem.wangNode=n;
      followStone(b,u,t.tileR,t.tileC);
    });
    bind(b,t,'death',ctx=>{
      if(ctx.unit!==t)return;if(t.mem.wangNode)t.mem.wangNode.active=false;
      // Protocol reuses the player's chosen tile after a trigger, including a
      // tile selected during combat. Inventory recovery resumes automatic deployment.
      t.removed=ctx.reason!=='expired'&&ctx.reason!=='killed';t.mem.wangReadyAt=b.time+t.base.respawnTime;
    });
  }}),
  [SOUL]:(bb)=>({trait:{noAttack:true},skill:{kind:'instant',trigger:'NEVER',spCost:5,initSp:0,spType:'time',
    onStart({battle:b,unit:t,skill:s}){
      const u=t.ownerUnit;if(!live(u))return;
      const es=foes(b,u,false).sort((a,z)=>Number(!!a.mem[`wisdel:${u.id}`])-Number(!!z.mem[`wisdel:${u.id}`])||a.spawnSeq-z.spawnSeq);
      const e=es[0];if(!e)return;
      const atk=t.s.atk,minSp=bb.sp_min||0,refund=minSp+b.rng.int((bb.sp_max||3)-minSp);
      // The model's OnAttack is at frame 1 (30 Hz); damage and SP return follow it.
      b.after(1/30,()=>{
        if(e.alive){damage(b,t,e,atk,'arts',['wisdel:soul']);b.applyStatus(e,'sluggish',{duration:bb.sluggish||1,source:t});
          e.mem[`wisdel:${u.id}`]=true;b.fx('soul',{x:e.x,y:e.y,id:t.id});}
        if(live(t))s.gainSp(refund,'wisdel:soul');
      });
    }},install(b,t){
    t.skill.manual=false;
    bind(b,t,'deploy',ctx=>{if(ctx.unit===t)t.mem.wisCamoGranted=!!(live(t.ownerUnit)&&!t.ownerUnit.s.flags.isolated);});
    pulse(b,t,0.1,()=>{
      const u=t.ownerUnit;if(live(u)&&t.skill.ready&&foes(b,u,false).length)t.skill.activate('auto');
    });
  }}),
  token_10068_kalts2_mtship:()=>({trait:{noAttack:true},install(b,t){stat(b,t,'kalts2:anchor',{}, {untargetable:true,invulnerable:true});}}),
};

export default {
  chess_custom_5_chen3_a:chen,
  chess_custom_5_kalts2_a:kalts,
  chess_custom_5_wisdel_a:wisdel,
  chess_custom_6_wang_a:wang,
  chess_custom_6_oblvns_a:oblvns,
};

