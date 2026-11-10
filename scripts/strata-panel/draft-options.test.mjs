import test from 'node:test';
import assert from 'node:assert/strict';
import {draftOptions, configureDraft, draftGates} from './draft-options.mjs';

test('tuned drafter gates are declared by the profile, never assumed from a model name',()=>{
  assert.deepEqual(draftGates(),{pack:undefined,model:undefined,quant:undefined,engineVersions:undefined});
  assert.deepEqual(draftGates({pack:'x.pack',model:'m-iq4',quant:'iq4_xs_v31',engineVersions:['0.1.59','0.2.13']}),
    {pack:'x.pack',model:'m-iq4',quant:'iq4_xs_v31',engineVersions:['0.1.59','0.2.13']});
  for (const bad of [{extra:1},{pack:''},{pack:'../evil.pack'},{pack:'a/b.pack'},{model:'x'.repeat(129)},
    {quant:'IQ4'},{quant:''},{engineVersions:[]},{engineVersions:['1.5']},{engineVersions:'0.1.59'},'array']) assert.throws(()=>draftGates(bad),`must reject ${JSON.stringify(bad)}`);
});

test('DFlash2 controls validate modes and do not confuse MTP probability with confidence',()=>{
  assert.deepEqual(draftOptions(),{mode:'auto',pack:'stock',window:6,confidence:0.8});
  for (const value of [{window:0},{window:1},{window:9},{confidence:0},{confidence:NaN},{mode:'maybe'},{pack:'unknown'},{extra:true}]) assert.throws(()=>draftOptions(value));
  const p={user_args:['--other','a b','--spec','2','--spec-min-p','0.5','--draft-conf','0.9']};
  configureDraft(p,{drafting:'dflash2'}, {mode:'manual',pack:'tuned',window:6,confidence:.8});
  assert.deepEqual(p.user_args,['--other','a b','--spec','6','--mtp-max-t','6','--draft-conf','0.8']);
  configureDraft(p,{drafting:'dflash2'},{mode:'auto'});
  assert.deepEqual(p.user_args,['--other','a b']);
  configureDraft(p,{drafting:'mtp',spec:2,specMinP:.5},{});
  assert.equal(p.drafting,'mtp'); assert.deepEqual(p.user_args,['--other','a b','--spec','2','--spec-min-p','0.5']);
});
