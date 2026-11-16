import path from 'node:path';
import {loadConfig} from '../../launcher.mjs';
import {catalogue,preferences,plugins,piConfiguration,prepare,save,piRequest,read,root,stateRoot} from './core.mjs';
import {samplingSpecs} from '../strata-panel/sampling.mjs';
import {engineOptionSpecs} from '../strata-panel/engine-options.mjs';
import {deepseekOptionSpecs} from './deepseek-options.mjs';
import fs from 'node:fs';
import {check} from '../strata-panel/core.mjs';
import {bridgeCommand} from '../strata-lan/lifecycle.mjs';
import {clientInfo} from '../strata-lan/bridge.mjs';
try {
  const [command,file]=process.argv.slice(2);let result;
  if(command==='catalogue') {
    const {deployment}=loadConfig();
    result={profiles:catalogue(),preferences:preferences(),plugins:plugins(),piAvailable:!!piConfiguration(),node:process.execPath,root,stateRoot,samplingSpecs,engineOptionSpecs,deepseekOptionSpecs,
      monitor:{available:false},engineReference:read(path.join(root,'scripts/strata-panel/engine-reference.json')),
      deployment:{control_version:deployment.engineVersion,engine_package_version:deployment.engineVersion}};
  }else if(command==='prepare')result=prepare(read(file));
  else if(command==='save')result=save(read(file));
  else if(command==='pi')result=await piRequest(read(file));
  else if(command==='lan-stop') result=bridgeCommand('lan-stop',read(file).id);
  else if(command==='lan-info') {
    const c=loadConfig(),r=read(file),p=c.profiles.find(p=>p.id===r.profile);
    if(!p)throw new Error('Unknown LAN profile');
    const v=check(p,c.deployment),base=c.lan?'http://'+c.lan.host+':'+c.lan.port:null;
    const dir=path.join(stateRoot,'lan');let latest;
    if(fs.existsSync(dir))for(const name of fs.readdirSync(dir)){
      if(!/^[a-f0-9-]{36}$/.test(name))continue;
      try{const s=bridgeCommand('lan-status',name);if(s.publicBase===base&&s.model===v.model&&(!latest||s.updated>latest.updated))latest=s;}catch{}
    }
    let capabilities=null;
    if(base)try{const response=await fetch(base+'/capabilities',{signal:AbortSignal.timeout(1500),redirect:'error'});if(response.ok)capabilities=await response.json();}catch{}
    const terminal=base?clientInfo(base):null;
    result={configured:!!c.lan,id:latest?.id ?? null,listening:latest?.state==='listening'&&!!capabilities,state:latest?.state==='listening'&&!capabilities?'Recorded listening; live capabilities unavailable':latest?.state ?? 'Not started',api:base?base+'/v1':null,allowedClients:c.lan?.allowedClients ?? [],capabilities,
      monitorCommand:terminal?'curl.exe --fail --noproxy "*" '+base+'/monitor-client.mjs --output strata-monitor.mjs\n# Verify SHA256: '+terminal.sha256+'\nnode strata-monitor.mjs --url '+base:null};
  }
  else throw new Error('catalogue | prepare/save/pi FILE');
  console.log(JSON.stringify(result));
}catch(error){console.error(error.message);process.exitCode=2;}
