import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {configSkeleton, detectInstalls, guessQuant, probePort, readModelProfile} from './inspect.mjs';

function tree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-detect-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const put = (name, data = '') => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
    return file;
  };
  put('Strata/components/control/0.2.13/strata.py');
  put('Strata/components/control/notaversion/strata.py');
  put('Strata/components/engine/0.2.13-windows-x86_64-cuda-cuda13/strata.exe');
  put('Strata/components/engine/0.2.13-windows-x86_64-cuda-cuda13/strata-vision.exe');
  put('Strata/components/engine/unversioned/strata.exe');
  put('models/node_modules/evil/package.json', {args: ['--native', 'x.gguf']});
  put('models/skip/a/b/c/d/e/f/ignored.json', {args: ['--native', 'x.gguf']});
  const vision = put('models/vision.json', {model_name: 'Demo Vision', args: ['--native', 'D:/w/demo-UD-IQ4_XS-v31-00001-of-00002.gguf',
    '--max-context', '131072'], vision: {mmproj: 'D:/w/mmproj.bin'}});
  const plain = put('models/plain.json', {model_name: 'Demo Plain', args: ['--native', 'D:/w/demo-q4_k_xl.gguf']});
  put('models/broken.json', '{');
  put('models/noargs.json', {model_name: 'Not A Strata Profile'});
  return {root, put, vision, plain};
}

test('detect finds only real control and engine components and rejects non-profile JSON', t => {
  const {root, put} = tree(t);
  const found = detectInstalls([root, path.join(root, 'models/missing')]);
  assert.equal(found.control.length, 2);
  assert.deepEqual(new Set(found.control.map(entry => entry.version)), new Set(['0.2.13', null]));
  assert.equal(found.engines.length, 2, 'only a directory holding strata.exe counts as an engine');
  assert.deepEqual(new Set(found.engines.map(entry => entry.version)), new Set(['0.2.13', null]));
  assert.equal(found.engines.find(entry => entry.version === '0.2.13').vision, true);
  assert.deepEqual(found.unreadable, [path.join(root, 'models/missing')]);
  assert.equal(found.models.length, 2, 'node_modules, unreadable JSON and files without weights are skipped');
  assert.deepEqual(found.models.map(model => path.basename(model.profile)).sort(), ['plain.json', 'vision.json']);
});

test('a model profile reports its weights, context, modality and quant guess', t => {
  const {root, put, vision} = tree(t);
  const model = readModelProfile(vision);
  assert.equal(model.model, 'Demo Vision');
  assert.equal(model.vision, true);
  assert.equal(model.context, '131072');
  assert.equal(model.weights, 'demo-UD-IQ4_XS-v31-00001-of-00002.gguf');
  assert.equal(model.suggestedQuant, 'iq4_xs_v31');
  assert.match(model.sha256, /^[0-9a-f]{64}$/);
  assert.equal(guessQuant(['model.gguf']), null);
  assert.equal(readModelProfile(path.join(root, 'models/noargs.json')), null);
  assert.equal(readModelProfile(put('models/big.json', 'x'.repeat(10)).replace('big.json', 'missing.json')), null);
});

test('the candidate config pairs matching versions and marks what only the operator can fill in', t => {
  const {root} = tree(t);
  const skeleton = configSkeleton(detectInstalls([root]));
  assert.equal(skeleton.candidateInstalls, 1, 'only the control and engine sharing one version pair up');
  assert.equal(skeleton.config.version, 1);
  assert.match(skeleton.config.deployment.controlDirectory.replace(/\\/g, '/'), /components\/control\/0\.2\.13$/);
  assert.match(skeleton.config.deployment.engineDirectory.replace(/\\/g, '/'), /components\/engine\/0\.2\.13-/);
  assert.equal(skeleton.config.deployment.engineVersion, '0.2.13');
  assert.deepEqual(new Set(skeleton.config.profiles.map(profile => profile.quant)), new Set(['iq4_xs_v31', 'q4_k_xl']));
  assert.deepEqual(new Set(skeleton.config.profiles.map(profile => profile.settings.port)), new Set([8081, 8082]));
  assert.equal(skeleton.config.profiles.every(profile => profile.minimumFreeGiB === null), true);
  assert.deepEqual(skeleton.fillIn.filter(key => key.endsWith('minimumFreeGiB')).length, 2);
  assert.ok(skeleton.fillIn.every(key => /minimumFreeGiB|quant|deployment/.test(key)), 'only unguessable fields are left null');

  const empty = configSkeleton(detectInstalls([]));
  assert.equal(empty.config.deployment, null);
  assert.equal(empty.config.profiles.length, 0);
  assert.ok(empty.fillIn.includes('deployment'));

  const orphan = configSkeleton({control: [{directory: 'C:/x/control/0.9.0', version: '0.9.0'}],
    engines: [{directory: 'C:/x/engine/0.9.9', version: '0.9.9', engine: true}], models: []});
  assert.equal(orphan.candidateInstalls, 0, 'a control version with no engine build cannot form a deployment');
});

test('port probe reports a free port once and the real reason once it is taken', async t => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  assert.deepEqual(await probePort(port), {port, free: false, reason: 'EADDRINUSE'});
  const before = await probePort(port + 1 > 65535 ? port - 1 : port + 1);
  assert.equal(before.free, true);
});
