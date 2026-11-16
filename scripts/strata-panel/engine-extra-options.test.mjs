import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {engineOptionSpecs,engineOptions,engineOverrides,engineOptionIdentity,applyEngineOptions} from './engine-options.mjs';

test('curated options have choices, explanations, risks and source entries; no runtime is required', () => {
  const reference=JSON.parse(fs.readFileSync(new URL('./engine-reference.json',import.meta.url),'utf8'));
  assert.equal(reference.engineVersion,'0.1.60');assert.ok(reference.entries.length>150);
  assert.equal(new Set(engineOptionSpecs.map(s=>s.key)).size,engineOptionSpecs.length);
  for(const s of engineOptionSpecs) {
    assert.ok(s.group && s.label && s.hint.length>20 && s.risk);assert.equal(s.values[0],'default');
    assert.equal(reference.entries.filter(r=>r.name===(s.env || s.flag)).length,1);
    for(const value of s.values) {
      assert.equal(engineOptions({[s.key]:value})[s.key],value);
      const profile={args:['--pack','D:/literal space'],user_args:[]};
      applyEngineOptions(profile,{[s.key]:value});
      if(value==='default') assert.deepEqual(profile.args,['--pack','D:/literal space']);
      else if(s.flag && s.booleanFlag) assert.equal(profile.user_args.includes(s.flag),value==='on');
      else if(s.flag) assert.deepEqual(profile.user_args,[s.flag,value]);
      else assert.ok(Object.hasOwn(profile.env,s.env));
    }
    assert.throws(()=>engineOptions({[s.key]:'bad; --pack other'}));
  }
});
test('defaults do not alter identities or flags; explicit old options keep their identity shape', () => {
  assert.deepEqual(engineOverrides(),{});assert.deepEqual(engineOptionIdentity(),{});
  assert.deepEqual(engineOptionIdentity({routePrior:'off'}),{engineOptions:{routePrior:'off',kva:'default',vramFree:'default'}});
  assert.deepEqual(engineOverrides({tailSkip:'0'}),{STRATA_ROUTE_TAIL_SKIP:'0'});
});
test('flag overrides remove duplicates, preserve literal paths and check incompatible modes', () => {
  const p={args:['--prefill','auto','--kv-grow','--pack','D:/a b'],user_args:['--prefill','512','--kv-grow'],env:{KEPT:'x'}};
  applyEngineOptions(p,{prefillChunk:'2048',kvGrow:'off',tailSkip:'0'});
  assert.deepEqual(p.args,['--pack','D:/a b']);assert.deepEqual(p.user_args,['--prefill','2048']);
  assert.deepEqual(p.env,{KEPT:'x',STRATA_ROUTE_TAIL_SKIP:'0'});
  const copy=structuredClone(p);applyEngineOptions(p,{});assert.deepEqual(p,copy);
  applyEngineOptions(p,{kvGrow:'on'});assert.equal(p.user_args.at(-1),'--kv-grow');
  assert.throws(()=>applyEngineOptions({}, {adaptEvery:'0'},true),/learning/);
  assert.throws(()=>applyEngineOptions({}, {adaptSwaps:'0'},true),/learning/);
  assert.throws(()=>applyEngineOptions({args:[]},{adaptOverlap:'1',adaptAsync:'1'}),/cannot/);
});
