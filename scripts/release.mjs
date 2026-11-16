// Build committed source only; never push, tag, upload or install dependencies.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const run=(exe,args,cwd=root)=>{
  const r=spawnSync(exe,args,{cwd,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
  if(r.status!==0)throw new Error(exe+': '+r.stderr);return r.stdout;
};
if(run('git',['status','--porcelain']).trim())throw new Error('Commit and review all public changes before building');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const commit=run('git',['rev-parse','HEAD']).trim();
const dist=path.join(root,'dist'),stage=path.join(dist,'stage-'+version+'-'+randomUUID());
fs.mkdirSync(stage,{recursive:true});
const archive=spawnSync('git',['archive','--format=tar',commit],{cwd:root,windowsHide:true,maxBuffer:16*1024*1024});
if(archive.status!==0)throw new Error('Git archive failed');
const tarFile=path.join(stage,'source.tar');fs.writeFileSync(tarFile,archive.stdout);
run('tar.exe',['-xf',tarFile,'-C',stage]);
const npmEntry=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
if(!fs.existsSync(npmEntry))throw new Error('Expected npm next to Node; use your trusted npm to pack manually');
const packed=JSON.parse(run(process.execPath,[npmEntry,'pack','--ignore-scripts','--json','--pack-destination',dist],stage))[0];
for(const f of packed.files){
  if(/^(runtime|logs|node_modules)\//.test(f.path)||/^conf\/(launcher|pi)\.json$/.test(f.path)||/\.(gguf|pack|safetensors|bin)$/.test(f.path))throw new Error('Private/weight asset in package: '+f.path);
}
const tgz=path.join(dist,packed.filename),extract=path.join(stage,'unpacked');fs.mkdirSync(extract);
run('tar.exe',['-xf',tgz,'-C',extract]);
const folder='strata-launcher-'+version;fs.renameSync(path.join(extract,'package'),path.join(extract,folder));
for(const f of packed.files){
  const name=path.join(extract,folder,f.path);
  if(!fs.statSync(name).isFile())throw new Error('Missing extracted package file');
  if(!/\.png$/.test(f.path)){
    const body=fs.readFileSync(name,'utf8');
    if(/192\.168\.0\.\d+|\bDESKTOP-[A-Z0-9]{5,}\b|S-1-5-21-(?:\d+-){2}\d+|C:[/\\]Users[/\\](?!Public|Default|USERNAME)[A-Za-z0-9_-]+|D:[/\\]WorkSpace[/\\][A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9]{20,}/i.test(body))throw new Error('Private identity/path detected: '+f.path);
  }
}
const zip=path.join(dist,'strata-launcher-v'+version+'-windows.zip');
if(fs.existsSync(zip))throw new Error('Archive already exists; do not overwrite a previous release');
run('tar.exe',['-a','-cf',zip,'-C',extract,folder]);
const sums=[zip,tgz].map(file=>({name:path.basename(file),sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),bytes:fs.statSync(file).size}));
fs.writeFileSync(path.join(dist,'SHA256SUMS.txt'),sums.map(x=>x.sha256+'  '+x.name).join('\n')+'\n');
fs.writeFileSync(path.join(dist,'v'+version+'-build.json'),JSON.stringify({version,commit,files:packed.files.map(f=>f.path),assets:sums,extracted:path.join(extract,folder)},null,2)+'\n');
console.log(JSON.stringify({version,commit,files:packed.files.length,assets:sums}));
