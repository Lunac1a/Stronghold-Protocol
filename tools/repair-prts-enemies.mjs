// Restore missing enemy models using the existing downloader and Spine processor.
// Verified PRTS viewer sources: 黄铜镜, 木制镇纸, 红木镇纸.
// Their viewer file names are authoritative even when meta.json is unavailable.
import {readFile,writeFile,access,mkdir} from 'node:fs/promises';
import {resolve,posix} from 'node:path';
import {Downloader} from './assets/downloader.mjs';
import {processModels} from './assets/spine.mjs';
const manifest=JSON.parse(await readFile('data/assets.json','utf8')),models=new Map(),unavailable=[];
await mkdir('.cache',{recursive:true});
const exists=async p=>access(resolve('public',p.replace(/^\//,''))).then(()=>true,()=>false);
const missing=[];
for(const [id,e] of Object.entries(manifest.enemies||{}))if(e.spine){const s=e.spine;if(!(await Promise.all([s.skel,s.atlas,...s.textures].map(exists))).every(Boolean))missing.push([id,s]);}
console.log('Missing enemy models:',missing.length);
await Promise.all(missing.map(async([id,s])=>{
 const stem=posix.basename(s.skel,'.skel'),url='https://torappu.prts.wiki/assets/enemy_spine/'+stem+'/meta.json';
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if(!r.ok&&!['enemy_1200_msfjin_2','enemy_1202_msfzhi','enemy_1202_msfzhi_2'].includes(stem))throw new Error('metadata '+r.status);
  const meta=r.ok?await r.json():{prefix:'https://torappu.prts.wiki/assets/enemy_spine/'+stem+'/',skin:{'默认':{'战斗':{file:stem}}}},skin=meta.skin['默认']||Object.values(meta.skin)[0],entry=skin['战斗']||Object.values(skin)[0];
  if(!entry?.file)throw new Error('No battle model');
  const prefix=meta.prefix+entry.file,rel=p=>p.replace(/^\/assets\//,''),key='enemy:'+stem;
  models.set(key,{key,kind:'enemy',dir:posix.dirname(rel(s.skel))+'/',pma:s.pma,baseUrl:meta.prefix,
   skel:{rel:rel(s.skel),urls:[prefix+'.skel']},atlas:{rel:rel(s.atlas),urls:[prefix+'.atlas'],mutable:true},
   pngs:s.textures.map(p=>({rel:rel(p),urls:[meta.prefix+posix.basename(p)]}))});
 }catch(e){unavailable.push({id,stem,error:e.message,url});}
}));
const dl=new Downloader({root:resolve('public/assets'),ledgerPath:resolve('.cache/missing-enemy-ledger.json'),concurrency:8,retries:1,timeoutMs:15000});await dl.loadLedger();
const result=await processModels(models,{root:resolve('public/assets'),dl,cachePath:resolve('.cache/missing-enemy-spine.json'),download:true});
const report={missing:missing.length,loaded:result.entries.size,unavailable,problems:result.problems,totals:dl.totals};await writeFile('.cache/missing-enemy-report.json',JSON.stringify(report,null,2));console.log(report);
if(unavailable.length || result.problems.length || result.entries.size !== models.size) process.exitCode=1;
