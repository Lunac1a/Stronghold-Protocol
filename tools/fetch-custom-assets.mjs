#!/usr/bin/env node
// Incremental custom art download: preserves the existing manifest and reuses the main asset pipeline.
import {readFile,writeFile,mkdir,rename,readdir,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CUSTOM_OPERATORS,addCustomAssetResearch} from './custom-operators.mjs';
import {loadIndexes} from './assets/cache.mjs';
import {indexAudio} from './assets/audio.mjs';
import {buildPlan} from './assets/plan.mjs';
import {Downloader} from './assets/downloader.mjs';
import {collectLeaves,downloadLeaves,resolveTemplate,contentHash} from './assets/manifest.mjs';
import {processModels} from './assets/spine.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),assets=join(root,'public','assets'),cache=join(root,'.cache');
const json=async p=>JSON.parse(await readFile(join(root,p),'utf8'));
const offline=process.argv.includes('--offline');
const [assets07,ops03,enemies05,maps05,dataTokens,current]=await Promise.all(['docs/research/07-assets.json','docs/research/03-operators.json','docs/research/05-enemies.json','docs/research/05-maps.json','data/tokens.json','data/assets.json'].map(json));
addCustomAssetResearch(assets07);
const {audioData,modelsData,charword}=await loadIndexes(root,{offline});
const plan=buildPlan({assets07,ops03,enemies05,maps05,audio:indexAudio(audioData),modelsData,charword,extraTokenIds:Object.keys(dataTokens)});
const ids=CUSTOM_OPERATORS.map(o=>o.charId),tokens=['token_10064_wang_stone1','token_10035_wisdel_wward','token_10068_kalts2_mtship'];
const template={chars:Object.fromEntries(ids.map(id=>[id,plan.template.chars[id]])),tokens:Object.fromEntries(tokens.filter(id=>plan.template.tokens[id]).map(id=>[id,plan.template.tokens[id]]))};
template.skills=Object.fromEntries(Object.entries(plan.template.skills).filter(([id])=>CUSTOM_OPERATORS.some(o=>id.startsWith('skchr_'+o.key+'_'))));
template.skillsById=Object.fromEntries(Object.entries(plan.template.skillsById||{}).filter(([id])=>CUSTOM_OPERATORS.some(o=>id.startsWith('skchr_'+o.key+'_'))));
const used=new Set();
const scan=v=>{if(!v||typeof v!=='object')return;if(v.model)used.add(v.model);else Object.values(v).forEach(scan);};scan(template);
const models=new Map([...plan.models].filter(([key])=>used.has(key)));
// Local client extraction is preferred when an upstream token model is absent.
for(const id of tokens){
 const dir=join(assets,'local','spine',id);
 const files=await readdir(dir).catch(()=>[]);
 const skeleton=files.find(f=>f.endsWith('.skel'));
 if(!skeleton)continue;
 const atlas=skeleton.replace(/\.skel$/,'.atlas');
 if(!files.includes(atlas))continue;
 const model=models.get('token:'+id);if(!model)continue;
 await mkdir(join(assets,model.dir),{recursive:true});
 for(const file of files)await copyFile(join(dir,file),join(assets,model.dir,file));
 model.skel={rel:model.dir+skeleton,urls:[],kind:'skel'};
 model.atlas={rel:model.dir+atlas,urls:[],kind:'atlas',mutable:true};
 model.pngs=files.filter(f=>f.endsWith('.png')).map(file=>({rel:model.dir+file,urls:[],kind:'png'}));
}
const dl=new Downloader({root:assets,ledgerPath:join(cache,'custom-assets-ledger.json'),timeoutMs:20000,retries:1,concurrency:8});
await dl.loadLedger();
const failures=offline?[]:await downloadLeaves(collectLeaves(template),dl,assets,'custom-art');
const spine=await processModels(models,{root:assets,dl,cachePath:join(cache,'custom-spine-info.json'),download:!offline});
const resolved=resolveTemplate(template,{root:assets,spine:spine.entries,sourceOf:rel=>dl.ledger.files[rel]?.url});
const merge=(a,b)=>{if(!b||typeof b!=='object'||Array.isArray(b))return b;const out={...a};for(const [key,v]of Object.entries(b))out[key]=merge(a?.[key],v);return out;};
for(const group of ['chars','tokens','skills','skillsById'])for(const [id,rec]of Object.entries(resolved.value[group]||{})){current[group] ||= {};current[group][id]=merge(current[group][id],rec);}
current.stats.chars=Object.keys(current.chars).length;
current.stats.charsWithBack=Object.values(current.chars).filter(c=>c.spine?.back).length;
current.stats.tokens=Object.keys(current.tokens).length;
current.stats.tokensWithSpine=Object.values(current.tokens).filter(t=>t.spine).length;
current.stats.skills=Object.keys(current.skills).length;
const {hash,stats,generator,version,...body}=current;current.hash=contentHash(body);
await writeFile(join(root,'data','assets.json.tmp'),JSON.stringify(current,null,2)+'\n');
await rename(join(root,'data','assets.json.tmp'),join(root,'data','assets.json'));
const missing=ids.flatMap(id=>{const c=resolved.value.chars[id]||{};return ['avatar','portrait','spine'].filter(k=>!c[k]||!Object.keys(c[k]).length).map(k=>id+'.'+k);});
for(const op of CUSTOM_OPERATORS)for(let i=1;i<=3;i++){const id='skchr_'+op.key+'_'+i;if(!resolved.value.skills[id])missing.push('skills.'+id);}
const report={date:new Date().toISOString(),failures,missing,spineProblems:spine.problems,models:[...spine.entries.keys?.()||Object.keys(spine.entries)],totals:dl.totals};
await mkdir(cache,{recursive:true});await writeFile(join(cache,'custom-assets-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(failures.length||missing.length||spine.problems.length)process.exitCode=1;
