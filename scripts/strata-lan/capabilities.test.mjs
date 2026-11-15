import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {describeCapabilities,launcherDefaults} from './capabilities.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const health = {service:'strata',status:'ok',loaded:true,model:'fixture-model',max_context:32768,images:true};
const props = {model_alias:health.model,default_generation_settings:{n_ctx:32768,params:{n_predict:4096}},modalities:{vision:true},total_slots:1,
  chat_template_caps:{supports_tools:true,supports_tool_calls:true,supports_parallel_tool_calls:false}};

test('capabilities report live context, explicit unknown reasoning and stable configuration fingerprint',()=>{
  const a=describeCapabilities(health,props,null,'http://192.168.1.10:8081');
  const b=describeCapabilities(health,props,null,'http://127.0.0.1:8881');
  assert.equal(a.fingerprint,b.fingerprint);assert.equal(a.context_tokens,32768);assert.equal(a.tool_calling,true);
  assert.equal(a.generation_defaults.reasoning_budget_tokens,null);assert.equal(a.pi_recommendation.request_defaults,null);
  assert.deepEqual(a.input_modalities,['text','image']);assert.equal(a.verification.generation_tested,false);
  assert.notEqual(a.fingerprint,describeCapabilities(health,{...props,default_generation_settings:{...props.default_generation_settings,params:{n_predict:2048}}},null).fingerprint);
});

test('capabilities reject inconsistent identity, modality, context and unloaded endpoints',()=>{
  for(const changed of [{...health,loaded:false},{...health,model:'other'},{...health,images:false},{...health,max_context:65536}]) {
    assert.throws(()=>describeCapabilities(changed,props,null));
  }
  const small=describeCapabilities({...health,max_context:4096},{...props,default_generation_settings:{n_ctx:4096,params:{n_predict:4096}}},null);
  assert.equal(small.pi_recommendation,null);assert.equal(small.generation_defaults.max_tokens,null);
});

test('reasoning defaults require matching model/config/shared hashes and verified DFlash2 alias',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'strata-capabilities-'));
  try {
    const dir=path.join(folder,'run');fs.mkdirSync(dir);
    const config={model_name:health.model,host:'127.0.0.1',port:8080,aliases:['client-alias']};
    const shared={max_tokens:4096,reasoning_budget_tokens:1024,reasoning_effort:'medium'};
    const configBytes=JSON.stringify(config),sharedBytes=JSON.stringify(shared);
    const run={model:health.model,clientModel:'client-alias',settings:{context:32768},vision:true,configHash:hash(configBytes),sharedHash:hash(sharedBytes)};
    fs.writeFileSync(path.join(dir,'model.json'),configBytes);fs.writeFileSync(path.join(dir,'model.shared-settings.json'),sharedBytes);
    fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(run));
    const models={data:[{id:health.model},{id:'client-alias',alias_of:health.model}]};
    const defaults=launcherDefaults(health,props,folder,models,8080);
    assert.equal(defaults.reasoning_budget_tokens,1024);
    assert.equal(describeCapabilities(health,props,defaults).model,'client-alias');
    assert.equal(launcherDefaults(health,props,folder,{data:[]},8080),null);
    assert.equal(launcherDefaults(health,props,folder,models,8082),null);
    fs.writeFileSync(path.join(dir,'model.shared-settings.json'),JSON.stringify({...shared,reasoning_budget_tokens:3072}));
    assert.equal(launcherDefaults(health,props,folder,models,8080),null);
  } finally {
    assert.equal(path.dirname(folder),os.tmpdir());assert.ok(path.basename(folder).startsWith('strata-capabilities-'));
    fs.rmSync(folder,{recursive:true});
  }
});
