import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import net from 'node:net';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

test('panel serves its page on loopback and protects state-changing routes', {timeout: 15000}, async t => {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const {port} = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url)), String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const closed = once(child, 'close');
  t.after(async () => { child.kill(); await closed; });
  const line = await Promise.race([
    once(child.stdout, 'data').then(([bytes]) => String(bytes)),
    closed.then(([code]) => { throw new Error('Web panel exited: ' + code); }),
    once(child.stderr, 'data').then(([bytes]) => { throw new Error(String(bytes)); }),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  assert.equal(JSON.parse(line).panel, origin + '/');
  const req = (url, opts) => fetch(origin + url, {...opts, signal: AbortSignal.timeout(3000)});
  const page = await req('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(await page.text(), /Strata Launcher/);
  const code = (url, opts) => req(url, opts).then(response => response.status);
  assert.equal(await code('/api/start?id=fixture', {method: 'POST'}), 403);
  assert.equal(await code('/api/stop?id=fixture', {method: 'POST', headers: {
    Origin: 'http://example.test', 'X-Strata-Panel': '1',
  }}), 403);
  assert.equal(await code('/api/stop?id=fixture', {method: 'POST', headers: {
    Origin: origin, 'X-Strata-Panel': '1',
  }}), 400);
  assert.equal(await code('/api/status?id=not-a-run'), 400);
  assert.equal(await code('/api/runs'), 200);
  const wrongHost = await new Promise((resolve, reject) => {
    http.get(origin, {headers: {Host: 'example.test'}}, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(wrongHost, 403);
});
