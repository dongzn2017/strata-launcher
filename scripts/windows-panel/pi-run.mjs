import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readPi,getJson,stateRoot} from './core.mjs';
const file=process.argv[2],m=readPi(file);
const h=await getJson(m.expected.port,'health');
if(!h.loaded||h.model!==m.expected.model||h.max_context!==m.expected.context||!!h.images!==m.expected.vision)throw new Error('Model changed before Pi launch');
const lock=path.join(stateRoot,'pi-active.lock'),token=randomUUID();
fs.writeFileSync(lock,JSON.stringify({pid:process.pid,token,manifest:file}),{flag:'wx'});
const cleanup=()=>{try{if(JSON.parse(fs.readFileSync(lock,'utf8')).token===token)fs.unlinkSync(lock);}catch{}};
// Pi treats Ctrl+C as interrupt, not necessarily exit: retain ownership until its child ends.
const interrupted=()=>{};
process.on('SIGINT',interrupted);
try {
  const args=[m.entry,'--offline','--no-extensions','--no-skills','--no-prompt-templates','--no-mcp',
    '--provider','local-llamacpp','--model',m.model,'--thinking',m.effort,
    '-e',fileURLToPath(new URL('./pi-extension.mjs',import.meta.url)),...m.extensions.flatMap(f=>['-e',f]),
    ...m.skills.flatMap(f=>['--skill',f]),...(m.sessionFile?['--session',m.sessionFile]:[])];
  const child=spawn(process.execPath,args,{cwd:m.cwd,stdio:'inherit',env:{...process.env,LOCAL_LLAMA_PANEL_PI:file,LOCAL_LLAMA_MONITOR_FIELDS:JSON.stringify(m.fields)}});
  const [code]=await once(child,'exit');process.exitCode=code ?? 1;
}finally{process.removeListener('SIGINT',interrupted);cleanup();}
