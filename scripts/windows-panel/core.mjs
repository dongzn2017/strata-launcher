import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadConfig,configFile} from '../../launcher.mjs';
import {read,write,root,stateRoot,digest,check,prepare as prepareModel,samplingDefaults} from './shared.mjs';
import {inheritedEngineOptions} from '../strata-panel/engine-options.mjs';
import {resourceOptions} from './resource-options.mjs';
import {samplingFields} from '../strata-panel/sampling.mjs';
export {read,write,root,stateRoot};
const uiFile=path.join(stateRoot,'windows-panel.json');
const piFile=path.join(root,'conf/pi.json');
const sections=['settings','sampling','engineOptions','draftOptions','learning'];
const within=(base,file)=>{const r=path.relative(base,path.resolve(file));return r!==''&&!r.startsWith('..')&&!path.isAbsolute(r);};
export function piConfiguration() {
  if(!fs.existsSync(piFile)) return null;
  const c=read(piFile);
  if(!c || typeof c.entry!=='string' || !path.isAbsolute(c.entry) || !fs.statSync(c.entry,{throwIfNoEntry:false})?.isFile()) throw new Error('conf/pi.json needs an existing absolute Pi entry script');
  if(!Array.isArray(c.extensions ?? [])) throw new Error('pi.extensions must be an array');
  const ids=new Set();
  for(const e of c.extensions ?? []) {
    if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(e.id) || ids.has(e.id) || typeof e.label!=='string' || !path.isAbsolute(e.path) || !fs.statSync(e.path,{throwIfNoEntry:false})?.isFile()) throw new Error('Invalid Pi extension id/label/absolute path');
    ids.add(e.id);
  }
  if(!Array.isArray(c.skills ?? []) || (c.skills ?? []).some(f=>!path.isAbsolute(f)||!fs.existsSync(f))) throw new Error('Pi skills must be existing absolute paths');
  return c;
}
export function plugins() { return (piConfiguration()?.extensions ?? []).map(e=>({...e,file:e.path,available:true,enabled:false})); }
export function catalogue() {
  const {profiles,deployment}=loadConfig();
  return profiles.map(p=>{
    try {
      const v=check(p,deployment);
      return {id:p.id,label:p.id,file:p.profile,family:'qwen',model:v.model,vision:v.vision,available:true,missing:[],settings:v.settings,
        inheritedEngineOptions:inheritedEngineOptions(v.profile),samplingDefaults:{thinking:samplingDefaults({effort:'medium',thinking:3072},v.profile.sampling),off:samplingDefaults({effort:'off',thinking:0},v.profile.sampling)}};
    }catch(error){return {id:p.id,label:p.id,available:false,missing:[error.message]};}
  });
}
export function preferences() {
  const c=loadConfig(); const ui=fs.existsSync(uiFile)?read(uiFile):{};
  const profiles=Object.fromEntries(c.profiles.map(p=>{
    const v=check(p,c.deployment);
    return [p.id,{settings:v.settings,sampling:v.sampling,engineOptions:v.advanced,draftOptions:v.drafting,learning:{enabled:v.routing.metadata.enabled,reuse:p.learning?.reuse ?? true,scope:p.learning?.scope ?? 'general',saveEveryMinutes:p.learning?.saveEveryMinutes ?? 5}}];
  }));
  const profile=Object.hasOwn(profiles,ui.profile)?ui.profile:c.profiles[0].id;
  return {...ui,profile,profiles,...profiles[profile],cwd:ui.cwd || root};
}
function requestProfile(request) {
  const {profiles,deployment}=loadConfig(); const item=profiles.find(p=>p.id===request.profile);
  if(!item) throw new Error('Unknown GUI profile');
  return {deployment,profile:{...item,...Object.fromEntries(sections.filter(s=>request[s]!==undefined).map(s=>[s,request[s]]))}};
}
export function prepare(request) {
  const {profile,deployment}=requestProfile(request);
  return prepareModel(profile,deployment);
}
export function save(request) {
  const resourceOptimization=resourceOptions(request.resourceOptimization);
  if(typeof request.cwd!=='string' || !fs.statSync(request.cwd,{throwIfNoEntry:false})?.isDirectory()) throw new Error('Pi working directory must exist');
  const lock=configFile+'.lock'; const fd=fs.openSync(lock,'wx');
  try {
    const original=fs.readFileSync(configFile),raw=read(configFile);
    const changes={...request.profiles,[request.profile]:request};
    for(const [id,change] of Object.entries(changes)) {
      const p=raw.profiles.find(p=>p.id===id);if(!p)throw new Error('Unknown GUI profile: '+id);
      for(const s of sections)if(change[s]!==undefined)p[s]=change[s];
    }
    const candidate=loadConfig(raw);for(const p of candidate.profiles)check(p,candidate.deployment);
    if(digest(fs.readFileSync(configFile))!==digest(original))throw new Error('Config changed concurrently; not saved');
    const backup=path.join(root,'logs/config-backups',randomUUID()+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,original,{flag:'wx'});
    write(configFile,raw);
    const ui={profile:request.profile,cwd:request.cwd,session:request.session,plugins:request.plugins ?? [],fields:request.fields ?? [],footer:request.footer!==false,resourceOptimization,savedAt:new Date().toISOString()};
    write(uiFile,ui);
    return {saved:true,savedAt:ui.savedAt,file:configFile,backup};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
export async function getJson(port,endpoint) {
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
  const r=await fetch('http://127.0.0.1:'+port+'/'+endpoint,{signal:AbortSignal.timeout(1800),redirect:'error'});
  if(!r.ok)throw new Error('Local service HTTP '+r.status); return r.json();
}
export async function piRequest(request) {
  const c=piConfiguration();if(!c)throw new Error('Configure your existing Pi in conf/pi.json first; no Pi is installed by this launcher');
  if(fs.existsSync(path.join(stateRoot,'pi-active.lock')))throw new Error('A launcher Pi owns pi-active.lock; do not start another or clear its lock automatically');
  const {profile,deployment}=requestProfile(request),expected=check(profile,deployment);
  const [h,p,m]=await Promise.all(['health','props','v1/models'].map(e=>getJson(expected.settings.port,e)));
  if(!h.loaded||h.service!=='strata'||h.status!=='ok'||h.api_key||h.max_context!==expected.settings.context||!!h.images!==expected.vision||h.model!==expected.model||p.total_slots!==1||p.default_generation_settings?.n_ctx!==h.max_context||p.model_alias!==h.model||!!p.modalities?.vision!==!!h.images)throw new Error('Live model/context/vision/slots do not match this Pi configuration');
  if(!m.data?.some(e=>e.id===expected.clientModel&&(e.id===h.model||e.alias_of===h.model)))throw new Error('Live model alias mismatch');
  const selected=request.plugins ?? []; const registered=plugins();
  if(!Array.isArray(selected)||selected.some(id=>!registered.some(e=>e.id===id)))throw new Error('Unregistered Pi extension');
  if(!['new','continue'].includes(request.session))throw new Error('Invalid Pi session mode');
  if(!fs.statSync(request.cwd,{throwIfNoEntry:false})?.isDirectory())throw new Error('Pi folder missing');
  const fingerprint=digest({apiModel:expected.clientModel,cwd:path.resolve(request.cwd),settings:expected.settings,sampling:expected.sampling}).slice(0,16);
  const file=path.join(stateRoot,'pi',randomUUID()+'.json'),indexFile=path.join(stateRoot,'pi-sessions',fingerprint+'.json');
  const prior=request.session==='continue'&&fs.existsSync(indexFile)?read(indexFile):null;
  const manifest={file,indexFile,fingerprint,model:'strata-panel-'+fingerprint,cwd:path.resolve(request.cwd),entry:c.entry,skills:c.skills ?? [],extensions:registered.filter(e=>selected.includes(e.id)).map(e=>e.file),
    expected:{port:expected.settings.port,model:h.model,apiModel:expected.clientModel,context:h.max_context,vision:!!h.images},output:expected.settings.output,thinking:expected.settings.thinking,effort:expected.settings.effort,sampling:expected.sampling,footer:request.footer!==false,fields:(request.fields ?? []).filter(f=>['speed','gpu','cpu','ram','temperature','disk','cache','prefill'].includes(f)),
    ...(prior?.fingerprint===fingerprint&&typeof prior.sessionFile==='string'&&fs.existsSync(prior.sessionFile)?{sessionFile:prior.sessionFile}:{})};
  write(file,manifest);return {file};
}
export function readPi(file) {
  if(!file||!within(path.join(stateRoot,'pi'),file))throw new Error('Not a GUI Pi manifest');
  const m=read(file),c=piConfiguration();
  if(!c||m.entry!==c.entry||!/^strata-panel-[a-f0-9]{16}$/.test(m.model)||!within(path.join(stateRoot,'pi-sessions'),m.indexFile)||m.extensions.some(f=>!plugins().some(e=>e.file===f))||JSON.stringify(m.skills)!==JSON.stringify(c.skills ?? []))throw new Error('Pi manifest identity/extension mismatch');
  return m;
}
export function payload(m,body) {
  const b={...body,model:m.expected.apiModel,max_tokens:Math.min(body.max_tokens>0?body.max_tokens:m.output,m.output)};
  if(m.sampling?.mode==='custom') Object.assign(b,samplingFields(m.sampling,{request:true}));
  const off=m.effort==='off'||m.thinking===0||b.chat_template_kwargs?.enable_thinking===false||b.reasoning_effort==='none';
  b.reasoning_budget_tokens=off?0:Math.min(m.thinking,b.max_tokens-1);
  b.chat_template_kwargs={...b.chat_template_kwargs,...(off?{enable_thinking:false}:{}),reasoning_budget_tokens:b.reasoning_budget_tokens};
  delete b.max_completion_tokens;return b;
}
