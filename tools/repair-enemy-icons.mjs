// Restore documented base-icon fallbacks already supported by assets/plan.mjs.
// Only missing files are filled; genuine variant icons are never replaced.
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {validate} from './assets/formats.mjs';
const manifest=JSON.parse(await readFile('data/assets.json','utf8'));
const ledger=JSON.parse(await readFile('.cache/assets-ledger.json','utf8').catch(()=>'{"files":{}}'));
const report=[];
for(const id of ['enemy_2001_duckmi_2','enemy_2002_bearmi_2','enemy_2034_sythef_2','enemy_2085_skzjxd_2']){
 const rec=manifest.enemies[id],base=id.replace(/_\d+$/,'');
 if(!rec?.icon||rec.spineAliasOf!==base)throw Error('Unexpected fallback mapping: '+id);
 const target=resolve('public',rec.icon.slice(1));if(await access(target).then(()=>true,()=>false))continue;
 const rel=`enemy/icon/${base}.png`,source=resolve('public/assets',rel),bytes=await readFile(source);
 if(!validate('png',bytes))throw Error('Invalid source PNG: '+source);
 await mkdir(dirname(target),{recursive:true});await copyFile(source,target);
 report.push({id,base,kind:'documented base icon fallback',target:rec.icon,source:`/assets/${rel}`,upstream:ledger.files[rel]?.url||null,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await mkdir('.cache',{recursive:true});if(report.length)await writeFile('.cache/enemy-icon-fallbacks.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({restored:report.length,ids:report.map(r=>r.id)}));
