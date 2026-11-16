import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {settingBounds, digest, write} from './strata-panel/core.mjs';
import {engineOptionSpecs} from './strata-panel/engine-options.mjs';

const mutable=new Set(['settings','sampling','engineOptions','draftOptions','learning','limits']);
export function parameterCatalogue() {
  const reference=JSON.parse(fs.readFileSync(new URL('./strata-panel/engine-reference.json',import.meta.url),'utf8'));
  return {version:'1.2.0',curatedEngineVersion:reference.engineVersion,
    settings:Object.fromEntries(Object.entries(settingBounds).map(([key,[minimum,maximum,integer]])=>[key,{minimum,maximum,type:integer?'integer':'number'}])),
    enums:{kv:['int8','k8v4'],drafting:['mtp','dflash2'],effort:['off','low','medium','high']},engineOptions:engineOptionSpecs,reference,
    notes:['default means inherit, not off','Extended engine options target engines 0.1.59/0.1.60','Noneditable reference entries are not arbitrary passthrough flags','Sampling, draftOptions and learning are defined in conf/launcher.schema.json']};
}

export function updateProfile(file,id,key,raw,validate) {
  const [section,name,...extra]=key.split('.');
  if (!mutable.has(section) || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name || '') || extra.length) throw new Error('set requires one supported section.field; paths, deployment and profile identity are read-only');
  const lock=file+'.lock';const fd=fs.openSync(lock,'wx');
  try {
    const original=fs.readFileSync(file);const config=JSON.parse(original.toString('utf8').replace(/^\uFEFF/,''));
    const profile=config.profiles?.find(p=>p.id===id);if(!profile) throw new Error(`Unknown profile: ${id}`);
    let value;try {value=JSON.parse(raw);} catch {value=raw;}
    if(section==='engineOptions' && typeof value==='number') value=String(value);
    const previous=profile[section]?.[name];profile[section]={...profile[section],[name]:value};validate(config,id);
    if(digest(fs.readFileSync(file))!==digest(original)) throw new Error('Configuration changed concurrently; no settings saved');
    const backup=path.resolve(path.dirname(file),'../logs/config-backups',randomUUID()+'.json');
    fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,original,{flag:'wx'});write(file,config);
    return {saved:true,profile:id,key,previous:previous ?? null,value,backup,restartRequired:true,note:'Existing runs are unchanged; model/runtime/profile files were not edited'};
  } finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}
