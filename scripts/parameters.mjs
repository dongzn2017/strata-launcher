import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {settingBounds, write} from './strata-panel/core.mjs';
import {engineOptionSpecs} from './strata-panel/engine-options.mjs';
import {draftingModes} from './strata-panel/draft-assets.mjs';

const mutable=new Set(['settings','sampling','engineOptions','draftOptions','learning','limits']);
export function parameterCatalogue() {
  const reference=JSON.parse(fs.readFileSync(new URL('./strata-panel/engine-reference.json',import.meta.url),'utf8'));
  return {version:'1.2.0',curatedEngineVersion:reference.engineVersion,
    settings:Object.fromEntries(Object.entries(settingBounds).map(([key,[minimum,maximum,integer]])=>[key,{minimum,maximum,type:integer?'integer':'number'}])),
    enums:{kv:['int8','k8v4'],drafting:draftingModes,effort:['off','low','medium','high']},engineOptions:engineOptionSpecs,reference,
    notes:['default means inherit, not off','Extended engine options target engines 0.1.59/0.1.60/0.1.62','Noneditable reference entries are not arbitrary passthrough flags','Sampling, draftOptions and learning are defined in conf/launcher.schema.json']};
}

export function updateProfile(file,id,key,raw,validate) {
  const [section,name,...extra]=key.split('.');
  if (!mutable.has(section) || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name || '') || extra.length) throw new Error('set requires one supported section.field; paths, deployment and profile identity are read-only');
  let value;try {value=JSON.parse(raw);} catch {value=raw;}
  if(section==='engineOptions' && typeof value==='number') value=String(value);
  const {previous,...result}=updateProfileFields(file,id,{[section]:{[name]:value}},validate);
  return {...result,key,previous:previous[section][name] ?? null,value};
}

export function configurationSnapshot(file) {
  const bytes=fs.readFileSync(file);
  const revision=createHash('sha256').update(bytes).digest('hex');
  return {bytes,revision,config:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))};
}

export function updateProfileFields(file,id,changes,validate,{expectedRevision}={}) {
  const conflict=()=>Object.assign(new Error('Configuration changed concurrently; reload before saving'),{code:'CONFIG_CONFLICT'});
  const lock=file+'.lock';const fd=fs.openSync(lock,'wx');
  try {
    const {bytes,revision,config}=configurationSnapshot(file);
    if (expectedRevision!==undefined && revision!==expectedRevision) throw conflict();
    const profile=config.profiles?.find(p=>p.id===id);if(!profile) throw new Error(`Unknown profile: ${id}`);
    const previous={};
    for (const [section,fields] of Object.entries(changes)) {
      if (!mutable.has(section) || Object.keys(fields).some(name=>['__proto__','prototype','constructor'].includes(name))) {
        throw new Error('Unsupported editable field');
      }
      previous[section]=Object.fromEntries(Object.keys(fields).map(name=>[name,profile[section]?.[name]]));
      profile[section]={...profile[section],...fields};
    }
    validate(config,id);
    if (!fs.readFileSync(file).equals(bytes)) throw conflict();
    const backup=path.resolve(path.dirname(file),'../logs/config-backups',randomUUID()+'.json');
    fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,bytes,{flag:'wx'});write(file,config);
    return {saved:true,profile:id,previous,backup,restartRequired:true,note:'Existing runs are unchanged; model/runtime/profile files were not edited'};
  } finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}
