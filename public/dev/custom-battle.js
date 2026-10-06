// A real shared-engine battle, rendered through the same path as the game. The
// stationary high-HP enemies and free initial cast are explicit acceptance fixtures.
import {data} from '../js/data.js';
import {assets} from '../js/assets.js';
import {createFieldView} from '../js/render/app.js';
import {loadBrowserSim} from '../js/battle/runner.js';
const $=id=>document.getElementById(id);
const operators=[['wang',6,'望'],['chen3',5,'赤刃明霄陈'],['kalts2',5,'凯尔希·思衡托'],['oblvns',6,'丰川祥子'],['wisdel',5,'维什戴尔']];
const state={ready:false,battle:null,view:null,paused:false,errors:[]};window.customBattle=state;
window.addEventListener('error',e=>state.errors.push(e.message));
window.addEventListener('unhandledrejection',e=>state.errors.push(String(e.reason)));
try{
 await data.loadAll('chess','tokens','items','enemies','stages','bonds','config');await assets.ready();
 const {spec,ds}=await loadBrowserSim();
 const view=await createFieldView($('field'),{data,assets,board:'2d',settings:{quality:'high',damageNumbers:true}});state.view=view;
 view.on('battleTileClick',tile=>{
  if($('operator').value!=='wang'||tile.button!==0||!state.battle)return;
  const b=state.battle;
  if(!b.queueCustomAction({tick:b.tickCount,playerId:'p1',action:{kind:'wang.place',uid:100,row:tile.row,col:tile.col}}))return;
  b.step();const result=b.customActionResults.at(-1);
  state.lastAction=result;feed();
  if(!result.ok)$('status').textContent+=` · 放棋子失败：${result.reason}`;
 });
 operators.forEach(([key,,name])=>$('operator').append(new Option(name,key)));
 function loadSkills(){
  const [key,tier]=operators.find(o=>o[0]===$('operator').value),rec=data.lookup('chess',`chess_custom_${tier}_${key}_a`);
  const old=$('skill').value;$('skill').replaceChildren();
  const skills=rec.skills.filter(s=>!rec.availableSkillIndices||rec.availableSkillIndices.includes(s.index));
  skills.forEach(s=>$('skill').append(new Option(`${s.index+1} · ${s.name}`,String(s.index))));
  $('skill').value=skills.some(s=>String(s.index)===old)?old:String(rec.skill.index);$('fever').disabled=key!=='oblvns';
  $('hint').textContent=key==='wang'?'左键选定棋子位置。棋子触发后，有费用、有库存且冷却结束就会自动在该处继续下；三技能库存棋子下完后自动结束，返还棋子后也会继续。正常对局可选中望后点击“放置棋子”选位置。':key==='kalts2'?'二技能自动发射医疗弹药，对敌人造成真实伤害并治疗附近友军；弹药用完后自动结束。':'';
 }
 function feed(){
  const b=state.battle;if(!b)return;
  if(state.burst){const v=state.burst;$('burst').textContent=`${v.inside?'范围内':'范围外'} · 主棋子1枚＋跟子${v.placements.length}枚 · 消耗弹药${v.initialAmmo-state.unit.skill.ammoLeft} · 跟子时刻：${v.placements.map(p=>p.time.toFixed(2)+'秒').join('、')}`;const total=v.hits.reduce((sum,h)=>sum+h.amount,0);$('burst').textContent+=` · 敌人1.2秒进入（法抗${v.resistance}） · 棋子命中${v.hits.length}次 · 每次伤害：${v.hits.map(h=>h.amount.toFixed(2)).join('、')||'等待触发'} · 棋子总伤害${total.toFixed(2)}`;}
  const ev=b.drainEvents();if(ev.length)view.pushEvents({fieldId:b.fieldId,gt:b.time,ev});view.pushSnapshot(b.snapshot());
  state.damage=b.allyUnits.filter(u=>u===state.unit||u.ownerUnit===state.unit).reduce((sum,u)=>sum+u.stats.dmg,0);
  $('status').textContent=`战斗验收场景 · ${b.time.toFixed(1)} 秒 · 伤害 ${Math.round(state.damage)} · ${b.errors.length?'模拟错误 '+b.errors.length:'运行正常'}（固定敌人与初次免费释放用于验收）`;
 }
 function start({wangPlacement=null}={}){
  const [key,tier]=operators.find(o=>o[0]===$('operator').value),skillIndex=Number($('skill').value),id=`chess_custom_${tier}_${key}_${$('elite').checked?'b':'a'}`;
  const units=[{uid:100,kind:'chess',chessId:id,row:10,col:5,skillIndex},{uid:101,kind:'chess',chessId:'chess_char_1_01_a',row:wangPlacement?9:11,col:wangPlacement?3:6}];
  // On this actual stage (10,6) is deep sea and cannot be selected for a normal piece.
  if(key==='wang'&&!wangPlacement)units.push({uid:102,kind:'token',tokenId:'token_10064_wang_stone1',ownerUid:100,row:12,col:4});
  // Anchor movement has separate terrain/placement tests. This fixture explicitly
  // preplaces an anchor to exercise the flight and its model on the stock board.
  if(key==='kalts2'&&skillIndex===2)units.push({uid:103,kind:'token',tokenId:'token_10068_kalts2_mtship',ownerUid:100,row:12,col:8});
  const enemyPos=wangPlacement?[wangPlacement.row,wangPlacement.col]:key==='wang'?[12,5]:key==='chen3'?[10,6]:[10,7];
  const route={motion:'WALK',start:enemyPos,end:enemyPos,checkpoints:[{type:'WAIT',time:10000}]};
  const s=spec.buildBattleSpec({battleId:'custom-preview',fieldId:'custom-preview',kind:'normal',stageId:'act2autochess_m04',seed:417,timeLimit:300,
   players:[{playerId:'p1',dir:'RIGHT',units}],routes:[route],spawns:[{enemyKey:'enemy_1007_slime',count:wangPlacement?1:3,interval:0.1,time:wangPlacement?1.2:0,route:0}],
   enemyOverrides:{enemy_1007_slime:{stats:{maxHp:1e7,atk:0,moveSpeed:0,...(wangPlacement?{res:Number($('wang-res').value)}:{})}}},flags:{startOpCooldown:0}});
  const b=spec.createBattleFromSpec(s,ds,{quiet:true});state.battle=b;state.unit=b.allyUnits.find(u=>u.uid===100);
  b.step();b.step();b.step();const patient=b.allyUnits.find(u=>u.uid===101);if(patient)patient.hp=patient.s.maxHp*0.2;
  state.unit.skill.activate('acceptance',{free:true});
  state.burst=null;$('burst').textContent='';
  if(wangPlacement){
   // Isolate the manual-placement burst from the initial stock-overflow pieces.
   state.unit.mem.wang.nodes=[];b._evq=b._evq.filter(ev=>!(ev[0]==='fx'&&(ev[1]==='wangStone'||ev[1]==='wangLink')));const placements=[],originalFx=b.fx.bind(b),begin=b.time;
   b.fx=(kind,payload)=>{if(kind==='wangStone'&&!placements.some(p=>p.row===payload.y&&p.col===payload.x))placements.push({time:b.time-begin,row:payload.y,col:payload.x});return originalFx(kind,payload);};
   state.burst={inside:state.unit.rangeKeys.includes(wangPlacement.row*21+wangPlacement.col),placements,initialAmmo:state.unit.skill.ammoLeft,hits:[],attack:state.unit.s.atk,resistance:Number($('wang-res').value)};
   const previousHp=new Map();b.on('damaged',c=>{const before=previousHp.get(c.target.id)??c.target.s.maxHp;previousHp.set(c.target.id,c.target.hp);if(c.dmg.tags?.includes('wang:stone'))state.burst.hits.push({time:b.time-begin,amount:c.amount,hpLoss:before-c.target.hp,piece:c.dmg.tags.find(t=>t.startsWith('wang:piece:')),raw:c.dmg.amount,penetration:c.dmg.resIgnoreFlat});});
   b.queueCustomAction({tick:b.tickCount,playerId:'p1',action:{kind:'wang.place',uid:100,...wangPlacement}});b.step();state.lastAction=b.customActionResults.at(-1);
  }
  view.setStage(data.lookup('stages',s.stageId));view.enterBattle(b.fieldMeta());view.setCamera('normal',{rect:b.rect,instant:true});view.setLocalFeed({on:true,speed:1});feed();
 }
 state.start=start;state.feed=feed;
 state.advance=seconds=>{for(let i=0;i<Math.ceil(seconds*30);i++){state.battle.step();feed();}};
 $('operator').onchange=()=>{loadSkills();start();};$('skill').onchange=start;$('elite').onchange=start;$('restart').onclick=start;
 $('wang-inside').onclick=()=>{ $('operator').value='wang';loadSkills();start({wangPlacement:{row:11,col:7}});};
 $('wang-outside').onclick=()=>{ $('operator').value='wang';loadSkills();start({wangPlacement:{row:11,col:3}});};
 $('pause').onclick=()=>{state.paused=!state.paused;$('pause').textContent=state.paused?'继续':'暂停';};
 $('fever').onclick=()=>{const b=state.battle,u=state.unit,f=b.customFever?.get(u.ownerId);if(!f)return;u.skill.stop();f.value=450;u.skill.activate('acceptance',{free:true});feed();};
 loadSkills();start();state.ready=true;
 let last=performance.now(),acc=0;
 function frame(now){const dt=Math.min(0.1,(now-last)/1000);last=now;if(!state.paused&&!state.battle.finished){acc+=dt;while(acc>=1/30){state.battle.step();acc-=1/30;}feed();}requestAnimationFrame(frame);}
 requestAnimationFrame(frame);
}catch(e){state.error=String(e.stack||e);$('status').textContent=state.error;}
