import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {read,write,stateRoot} from '../strata-panel/core.mjs';
import {createBridge,clientInfo} from './bridge.mjs';

const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function bridgeCommand(action,id) {
  if(!validId.test(id)) throw new Error('Expected the LAN run UUID');
  const dir=path.join(stateRoot,'lan',id),owner=read(path.join(dir,'owner.json')),status=read(path.join(dir,'status.json'));
  if(owner.id!==id || status.id!==id || !/^[0-9a-f]{32}$/.test(owner.token || '')) throw new Error('LAN ownership record mismatch');
  if(action==='lan-status' || ['stopped','error'].includes(status.state)) return status;
  write(path.join(dir,'stop.json'),{id,token:owner.token});return {id,state:'stop-requested'};
}

export async function serveBridge(options,upstreamPort,expectedModel) {
  const id=randomUUID(),token=randomUUID().replaceAll('-',''),dir=path.join(stateRoot,'lan',id);
  const publicBase=`http://${options.host}:${options.port}`;
  const status=(state,extra={})=>write(path.join(dir,'status.json'),{id,state,pid:process.pid,publicBase,upstream:`http://127.0.0.1:${upstreamPort}`,model:expectedModel,updated:new Date().toISOString(),...extra});
  write(path.join(dir,'owner.json'),{id,token});status('starting');
  const server=createBridge({allowed:options.allowedClients,upstreamPort,expectedModel,publicBase,
    onAccess:row=>fs.appendFileSync(path.join(dir,'access.jsonl'),JSON.stringify({time:new Date().toISOString(),...row})+'\n')});
  let timer,closing=false;
  const stop=()=>{if(closing)return;closing=true;server.close();server.closeAllConnections();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port,options.host,resolve);});
    status('listening');
    console.log(JSON.stringify({id,directory:dir,state:'listening',api:publicBase+'/v1',capabilities:publicBase+'/capabilities',terminal:clientInfo(publicBase),allowedClients:options.allowedClients}));
    const closed=new Promise((resolve,reject)=>{server.once('close',resolve);server.once('error',reject);});
    timer=setInterval(()=>{try{const request=read(path.join(dir,'stop.json'));if(request.id===id && request.token===token)stop();}catch(error){if(error.code!=='ENOENT')status('listening',{stopError:'Unreadable stop request; no action taken'});}},500);
    timer.unref();await closed;status('stopped');
  } catch(error){status('error',{error:error.message});throw error;}
  finally{clearInterval(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);server.close();server.closeAllConnections();}
}
