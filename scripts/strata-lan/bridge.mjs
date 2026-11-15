import http from 'node:http';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {privateIPv4} from './monitor-client.mjs';
import {launcherDefaults,describeCapabilities} from './capabilities.mjs';

const readRoutes=new Set(['/health','/props','/metrics','/v1/models','/v1/status','/v1/telemetry']);
const inferRoutes=new Set(['/v1/chat/completions','/v1/completions','/v1/messages']);
const clientFile=new URL('./monitor-client.mjs',import.meta.url);
export function lanOptions(value) {
  if(value===undefined) return null;
  if(!value || Array.isArray(value) || typeof value!=='object' || Object.keys(value).some(k=>!['host','port','allowedClients'].includes(k))) throw new Error('lan: expected host, port and allowedClients only');
  if(!privateIPv4(value.host) || !Number.isInteger(value.port) || value.port<1024 || value.port>65535 ||
     !Array.isArray(value.allowedClients) || !value.allowedClients.length || value.allowedClients.some(ip=>!privateIPv4(ip))) {
    throw new Error('lan requires an explicit private/loopback IPv4 host, port 1024..65535 and exact private/loopback allowedClients; no wildcards or public bind');
  }
  return {host:value.host,port:value.port,allowedClients:[...new Set(value.allowedClients)]};
}

export function clientInfo(publicBase) {
  const bytes=fs.readFileSync(clientFile);
  return {url:publicBase+'/monitor-client.mjs',sha256:createHash('sha256').update(bytes).digest('hex'),
    command:`node strata-monitor.mjs --url ${publicBase}`,readOnly:true,transport:'HTTP private LAN only; no TLS or API authentication'};
}

export function createBridge({allowed,upstreamPort,publicBase,expectedModel,defaultsReader=launcherDefaults,onAccess=()=>{}}) {
  async function discover() {
    const [health,props,models]=await Promise.all(['health','props','v1/models'].map(async route=>{
      const response=await fetch(`http://127.0.0.1:${upstreamPort}/${route}`,{signal:AbortSignal.timeout(3000),redirect:'error'});
      if(!response.ok) throw new Error('Upstream metadata unavailable');return response.json();
    }));
    if(health.model!==expectedModel || !Array.isArray(models.data) || !models.data.some(model=>model.id===expectedModel)) {
      throw new Error('Upstream model does not match the selected profile or /v1/models');
    }
    let defaults=null;try{defaults=defaultsReader(health,props,undefined,models,upstreamPort);}catch{}
    return describeCapabilities(health,props,defaults,publicBase);
  }
  return http.createServer(async(req,res)=>{
    const ip=(req.socket.remoteAddress || '').replace(/^::ffff:/,'');
    if(!allowed.includes(ip)){onAccess({ip,allowed:false});res.writeHead(403).end('Forbidden');return;}
    if(req.headers.origin && req.headers.origin!==publicBase){res.writeHead(403).end('Cross-origin requests denied');return;}
    let pathname;
    try{if(!req.url.startsWith('/') || req.url.startsWith('//'))throw new Error();pathname=new URL(req.url,'http://localhost').pathname;}
    catch{res.writeHead(400).end('Bad request');return;}
    onAccess({ip,allowed:true,method:req.method,path:pathname});
    if(pathname==='/monitor-client.mjs' && req.method==='GET'){
      res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}).end(fs.readFileSync(clientFile));return;
    }
    if(pathname==='/capabilities' && req.method==='GET'){
      try{const result=await discover();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(result));}
      catch{res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({ready:false,error:'Upstream unavailable or profile identity changed'}));}return;
    }
    const inference=inferRoutes.has(pathname) && req.method==='POST';
    if(!inference && !(readRoutes.has(pathname) && req.method==='GET')){res.writeHead(404).end('Not found');return;}
    if(inference){
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')){res.writeHead(415).end('JSON required');return;}
      try{await discover();}catch{res.writeHead(503).end('Upstream unavailable or profile identity changed');return;}
    }
    const proxy=http.request({host:'127.0.0.1',port:upstreamPort,method:req.method,path:req.url,
      headers:{...req.headers,host:`127.0.0.1:${upstreamPort}`}},upstream=>{
      upstream.on('error',()=>res.destroy());res.writeHead(upstream.statusCode,{...upstream.headers,...(req.method==='GET'?{'cache-control':'no-store'}:{})});upstream.pipe(res);
    });
    proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Upstream unavailable');});
    req.on('aborted',()=>proxy.destroy());res.on('close',()=>{if(!res.writableFinished)proxy.destroy();});req.pipe(proxy);
  });
}
