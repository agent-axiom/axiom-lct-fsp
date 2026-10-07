// A clean-clone runtime smoke test. No external email, platform identity, or credentials.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const origin = 'http://127.0.0.1:8787';
const child = spawn(process.execPath, [
  '--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js',
  'dev', '--config', 'dist/server/wrangler.json', '--local',
  '--persist-to', '.wrangler/state', '--ip', '127.0.0.1', '--port', '8787',
  '--inspector-port', '0',
], {
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, FSP_REAL_ACCOUNTS_ENABLED: 'false', FSP_EMAIL_MODE: 'off'},
});
let logs = '';
let startError;
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
  logs = (logs + data.toString()).slice(-8000);
});
child.on('error', error => { startError = error; });
try {
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (startError) throw startError;
    if (child.exitCode !== null) throw new Error(`Local server exited: ${child.exitCode}\n${logs}`);
    try {
      const response = await fetch(origin, {signal: AbortSignal.timeout(3000), redirect: 'manual'});
      if (response.status === 200) { ready = true; break; }
    } catch { /* The server can still be starting. */ }
    await delay(500);
  }
  assert.ok(ready, `Local server did not become ready within 60 seconds.\n${logs}`);
  const home = await fetch(origin, {signal: AbortSignal.timeout(5000), redirect: 'manual'});
  assert.equal(home.status, 200, 'Anonymous home must be accessible');
  assert.match(await home.text(), /ФСП|ТАЛАНТЫ/);
  const privateState = await fetch(`${origin}/api/state`, {signal: AbortSignal.timeout(5000)});
  assert.equal(privateState.status, 401, 'Anonymous requests must not enter personal workspace');
  const guest = await fetch(`${origin}/api/guest/state`, {signal: AbortSignal.timeout(5000)});
  assert.equal(guest.status, 200, 'Synthetic guest API must be available');
  assert.match(guest.headers.get('content-type') || '', /application\/json/);
  assert.match(guest.headers.get('set-cookie') || '', /__Host-fsp_guest=/);
  await guest.json();
  console.log(JSON.stringify({cleanLaunch: 'passed', home: 200, privateState: 401, guestState: 200,
    realEmail: 'off', browserE2E: 'not covered by this HTTP smoke test'}));
} finally {
  if (child.pid) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
