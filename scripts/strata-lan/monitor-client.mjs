import http from 'node:http';
import https from 'node:https';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {isIP} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';

export function endpoint(raw) {
  const u = new URL(raw);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Use a server root URL without credentials or a path');
  if (u.protocol === 'http:' && u.hostname !== 'localhost' && !privateIPv4(u.hostname)) throw new Error('HTTP is limited to loopback or a trusted private IPv4 LAN; use HTTPS elsewhere');
  return u.origin;
}
export function privateIPv4(host) {
  if(isIP(host)!==4) return false;
  const [a,b]=host.split('.').map(Number);
  return a===127 || a===10 || a===192 && b===168 || a===172 && b>=16 && b<=31;
}

export async function snapshot(base, signal) {
  const url = new URL('/metrics', endpoint(base));
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(url, {signal, headers: {accept:'application/json'}}, res => {
      if (res.statusCode !== 200 || !res.headers['content-type']?.includes('application/json')) {
        res.resume(); reject(new Error(`Telemetry unavailable (HTTP ${res.statusCode})`)); return;
      }
      let size = 0; const chunks = [];
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) req.destroy(new Error('Telemetry exceeds 2 MiB'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!value?.engine || !value?.live || typeof value.engine.model !== 'string') throw new Error('Unsupported telemetry schema');
          if (!Number.isFinite(value.time) || Math.abs(Date.now()/1000 - value.time) > 30) throw new Error('Telemetry is stale or server/client clocks differ by over 30 seconds');
          resolve(value);
        } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Telemetry timeout (3s)')), 3000);
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
  });
}

const clean = value => String(value ?? '--').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
const number = (n, digits = 1) => Number.isFinite(n) ? n.toFixed(digits) : '--';
const gib = n => Number.isFinite(n) ? number(n/2**30) : '--';
const percent = n => Number.isFinite(n) && n >= 0 && n <= 1 ? number(n*100) + '%' : '--';

export function render(m, {width = 100, height = 28, base = '', error = null} = {}) {
  const lines = ['STRATA TERMINAL MONITOR | read-only', clean(base), ''];
  if (error) lines.push('UNAVAILABLE: ' + clean(error), 'No cached readings are displayed.');
  else {
    const e = m.engine, l = m.live, h = m.hardware || {}, last = m.requests?.[0] || {};
    lines.push('Model   ' + clean(e.model));
    lines.push(`State   ${clean(l.state)} / ${clean(l.phase)}   Queued ${number(l.queued,0)}   Context max ${number(e.max_context,0)}`);
    lines.push(`TG now  ${l.state === 'generating' ? number(l.tok_s) : '--'} tok/s   PP active ${number(l.prefill_tok_s_mean)} tok/s`);
    lines.push(`Last    TG ${number(last.decode_tok_s)} tok/s   Input ${number(last.prompt_tokens,0)}   Output ${number(last.output_tokens,0)}`);
    lines.push(`Read    ${number(l.prompt_read,0)} / ${number(l.prompt_total,0)}   Generated ${number(l.generated,0)} / ${number(l.max_tokens,0)}`);
    lines.push('');
    lines.push(`GPU     ${number(h.gpu_util,0)}%   VRAM ${gib(h.gpu_mem_used)} / ${gib(h.gpu_mem_total)} GiB   ${number(h.gpu_temp,0)} C   ${number(h.gpu_power,0)} W`);
    lines.push(`CPU     ${number(h.cpu_pct ?? h.cpu,0)}%   RAM ${gib(h.ram_used)} / ${gib(h.ram_total)} GiB`);
    lines.push(`Disk    R ${number(h.disk_read_mb)}   W ${number(h.disk_write_mb)} MiB/s [system]`);
    lines.push(`Experts ${number(e.expert_slots,0)} / ${number(e.experts,0)}   Cache ${Number.isFinite(e.expert_cache_mib) ? number(e.expert_cache_mib/1024) : '--'} GiB`);
    const acceptance = Number.isFinite(last.drafts_accepted) && last.drafts_offered > 0 ? last.drafts_accepted / last.drafts_offered : null;
    lines.push(`Draft   ${clean(e.drafting)}   Accepted ${percent(acceptance)} [last]   EC ${percent(last.hit_rate)} [last]   PCIe ${percent(last.pcie_share)} [last]`);
    lines.push('');
    lines.push('Recent requests (no prompts or answers)');
    for (const r of (m.requests || []).slice(0,4)) lines.push(`  ${clean(r.finish_reason ?? r.finish ?? 'unknown')}   in ${number(r.prompt_tokens,0)}   out ${number(r.output_tokens,0)}   TG ${number(r.decode_tok_s)} tok/s`);
    lines.push('Sample  ' + new Date(m.time * 1000).toISOString());
  }
  const rows = Math.max(4, Math.floor(height));
  lines.push('', 'q / Ctrl+C: close this monitor only; model and LAN bridge keep running.');
  const visible = lines.length > rows ? [...lines.slice(0,rows-1),lines.at(-1)] : lines;
  return visible.map(line => clean(line).slice(0, Math.max(1,width-1))).join('\n');
}

export async function main(args) {
  let base = 'http://127.0.0.1:8080', once = false, interval = 2000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url') base = endpoint(args[++i]);
    else if (args[i] === '--once') once = true;
    else if (args[i] === '--interval') interval = Number(args[++i])*1000;
    else throw new Error('Use --url URL, --once, --interval SECONDS (2..30)');
  }
  if (!Number.isFinite(interval) || interval < 2000 || interval > 30000) throw new Error('Interval must be 2..30 seconds');
  const tty = !!process.stdout.isTTY && !!process.stdin.isTTY;
  if (!tty && !once) throw new Error('Interactive terminal required; use --once for a bounded snapshot');
  const stop = new AbortController();
  const quit = () => stop.abort();
  const input = value => { if (value.includes('q') || value.includes('\x03')) quit(); };
  const raw = process.stdin.isRaw;
  process.on('SIGINT',quit); process.on('SIGTERM',quit);
  if (tty && !once) {
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8'); process.stdin.on('data',input);
  }
  try {
    do {
      let m = null, error = null;
      try { m = await snapshot(base, stop.signal); }
      catch (caught) { if (stop.signal.aborted) break; error = caught.message; }
      const output = render(m,{base,error,width:process.stdout.columns || 110,height:process.stdout.rows || 28});
      if (tty && !once) process.stdout.write('\x1b[H\x1b[2J' + output.replaceAll('\n','\r\n'));
      else console.log(output);
      if (once) { if (error) process.exitCode = 1; break; }
      await sleep(interval,undefined,{signal:stop.signal}).catch(() => {});
    } while (!stop.signal.aborted);
  } finally {
    process.removeListener('SIGINT',quit); process.removeListener('SIGTERM',quit);
    if (tty && !once) {
      process.stdin.removeListener('data',input); process.stdin.setRawMode(!!raw); process.stdin.pause();
      process.stdout.write('\x1b[?25h\x1b[?1049l');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {console.error(error.message);process.exitCode = 2;});
}
