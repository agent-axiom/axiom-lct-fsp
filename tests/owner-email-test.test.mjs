import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {handleOwnerEmailTest, ownerEmailTestConfiguration, OWNER_EMAIL_TEST_ID} from '../lib/owner-email-test.mjs';
import {realAccountsConfiguration} from '../lib/real-accounts.mjs';
const origin = 'https://fsp.example.test';
const user = {userId: 'synthetic-owner', email: 'owner@example.test'};
const config = {enabled: true, ownerEmail: user.email, apiKey: 'synthetic-not-a-credential', siteOrigin: origin};
const accepted = () => new Response(JSON.stringify({id: 'synthetic-provider-message'}), {status: 200});
const request = (body = {action: 'send-owner-test'}, options = {}) => new Request(`${origin}/api/owner/email-test`, {method: 'POST', headers: {origin, 'content-type': 'application/json', ...options.headers}, body: JSON.stringify(body), ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'headers'))});
function fixture() {
  const db = sqliteD1(); let now = Date.now(); const calls = [];
  const f = {db, calls, close: () => db.close(), reply: accepted, advance: n => {now += n;}};
  f.call = (req = request(), extra = {}) => handleOwnerEmailTest(req, {user, db, config, clock: () => now, fetcher: async (...args) => {calls.push(args); return f.reply(...args);}, ...extra});
  f.row = () => db.prepare('SELECT * FROM owner_email_tests').first();
  return f;
}
test('one accepted message, fixed target/payload, manual redirects and runtime-only secret', async () => {
  const f = fixture(); try {
    assert.deepEqual(await (await f.call()).json(), {status: 'accepted'});
    const [url, init] = f.calls[0]; assert.equal(url, 'https://api.resend.com/emails'); assert.equal(init.redirect, 'manual'); assert.equal(init.headers['Authorization'], `Bearer ${config.apiKey}`); assert.equal(init.headers['Idempotency-Key'], OWNER_EMAIL_TEST_ID);
    const payload = JSON.parse(init.body); assert.deepEqual(payload.to, [user.email]); assert.equal(payload.from, 'onboarding@resend.dev'); assert.equal(Object.keys(payload).sort().join(), 'from,subject,text,to');
    const row = await f.row(); assert.equal(row.status, 'accepted'); assert.equal(row.provider_message_id, 'synthetic-provider-message'); assert.match(row.principal_hash, /^[a-f0-9]{64}$/); assert.match(row.payload_hash, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(row).includes(user.email)); assert.ok(!JSON.stringify(row).includes(config.apiKey)); assert.ok(!JSON.stringify(row).includes(user.userId));
  } finally {f.close();}
});
test('replay, GET, page refresh and provider 24h expiry cannot resend', async () => {
  const f = fixture(); try {await f.call(); f.advance(3 * 86400000); assert.equal((await (await f.call()).json()).replay, true); const r = await f.call(new Request(`${origin}/api/owner/email-test`)); assert.equal(r.headers.get('Cache-Control'), 'no-store'); assert.deepEqual(await r.json(), {status: 'accepted', enabled: true}); assert.equal(f.calls.length, 1);} finally {f.close();}
});
test('missing, empty or wrong platform identity cannot read, claim or send', async () => {
  const f = fixture(); try {for (const forged of [null, {userId: '', email: user.email}, {userId: 'other', email: 'other@example.test'}]) {assert.ok([401, 403].includes((await f.call(request(), {user: forged})).status));} assert.equal(await f.row(), null); assert.equal(f.calls.length, 0);} finally {f.close();}
});
test('same approved email on another Site identity cannot reopen or read first claim', async () => {
  const f = fixture(); try {await f.call(); for (const req of [request(), new Request(`${origin}/api/owner/email-test`)]) assert.equal((await f.call(req, {user: {...user, userId: 'another-identity'}})).status, 403); assert.equal(f.calls.length, 1);} finally {f.close();}
});
test('cross-origin, missing Origin, wrong host, input overrides, query parameters and malformed requests fail before claim', async () => {
  const f = fixture(); try {
    const invalid = [request(undefined, {headers: {origin: 'https://evil.example'}}), request(undefined, {headers: {origin: ''}}), request({action: 'send-owner-test', to: 'other@example.test'}), request({action: 'send-owner-test', user}), request([]), request('send-owner-test'), request({action: 'send-owner-test', body: 'custom'}), request(undefined, {headers: {'content-type': 'text/plain'}}), new Request(`${origin}/api/owner/email-test?send=1`, {method: 'POST', body: '{}'}), new Request('https://wrong.example/api/owner/email-test', {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: '{"action":"send-owner-test"}'}), new Request(`${origin}/api/owner/email-test`, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: '{'})];
    for (const req of invalid) assert.ok((await f.call(req)).status >= 400);
    assert.equal(await f.row(), null); assert.equal(f.calls.length, 0);
  } finally {f.close();}
});
test('disabled and incomplete config fails before claim', async () => {
  const f = fixture(); try {for (const override of [{enabled: false}, {apiKey: ''}, {siteOrigin: 'http://fsp.example.test'}, {siteOrigin: origin + '/'}, {siteOrigin: origin + '/path'}]) assert.equal((await f.call(request(), {config: {...config, ...override}})).status, 503); assert.equal(await f.row(), null); assert.equal(f.calls.length, 0);} finally {f.close();}
});
test('parallel requests cause exactly one provider POST', async () => {
  const f = fixture(); let release; const blocker = new Promise(resolve => {release = resolve;}); let entered; const reached = new Promise(resolve => {entered = resolve;});
  try {f.reply = async () => {entered(); await blocker; return accepted();}; const first = f.call(); await reached; const second = await f.call(); assert.equal((await second.json()).status, 'sending'); assert.equal(f.calls.length, 1); release(); assert.equal((await (await first).json()).status, 'accepted');} finally {release(); f.close();}
});
test('network ambiguity is permanently locked; status read does not retry', async () => {
  const f = fixture(); try {f.reply = () => {throw new Error('provider error with private data');}; const r = await (await f.call()).json(); assert.deepEqual(r, {status: 'unknown', code: 'DELIVERY_UNKNOWN'}); await f.call(); assert.equal(f.calls.length, 1); assert.equal((await f.row()).status, 'unknown');} finally {f.close();}
});
for (const [label, reply, status, code] of [
  ['redirect', () => new Response(null, {status: 302, headers: {location: 'https://attacker.example'}}), 'unknown', 'UNEXPECTED_REDIRECT'],
  ['unauthorized', () => new Response('PRIVATE_PROVIDER_SENTINEL', {status: 401}), 'rejected', 'HTTP_401'],
  ['wrong recipient/provider permission', () => new Response('PRIVATE_PROVIDER_SENTINEL', {status: 403}), 'rejected', 'HTTP_403'],
  ['server ambiguity', () => new Response('PRIVATE_PROVIDER_SENTINEL', {status: 500}), 'unknown', 'HTTP_500'],
  ['malformed JSON', () => new Response('not JSON', {status: 200}), 'unknown', 'INVALID_PROVIDER_RESPONSE'],
  ['empty provider id', () => new Response('{"id":""}', {status: 200}), 'unknown', 'INVALID_PROVIDER_RESPONSE'],
]) test(`${label} is sanitized and never retried`, async () => {const f = fixture(); try {f.reply = reply; assert.deepEqual(await (await f.call()).json(), {status, code}); await f.call(); assert.equal(f.calls.length, 1); assert.ok(!JSON.stringify(await f.row()).includes('PRIVATE_PROVIDER_SENTINEL'));} finally {f.close();}});
test('fetch and JSON body timeout settle without retry even when mock ignores abort', async () => {
  for (const reply of [() => new Promise(() => {}), () => new Response(new ReadableStream({start() {}}), {status: 200})]) {
    const f = fixture(); try {f.reply = reply; assert.deepEqual(await (await f.call(request(), {timeoutMs: 5})).json(), {status: 'unknown', code: 'DELIVERY_UNKNOWN'}); await f.call(); assert.equal(f.calls.length, 1);} finally {f.close();}
  }
});
test('DB failure after acceptance cannot reopen the claimed event', async () => {
  const f = fixture(); const prepare = f.db.prepare.bind(f.db); try {
    f.db.prepare = sql => {const statement = prepare(sql); if (sql.startsWith('UPDATE owner_email_tests')) statement.run = async () => {throw new Error('simulated storage loss');}; return statement;};
    assert.equal((await f.call()).status, 503); assert.equal((await f.row()).status, 'sending'); f.advance(20000); const replay = await (await f.call()).json(); assert.equal(replay.status, 'unknown'); assert.equal(replay.replay, true); assert.equal(f.calls.length, 1);
  } finally {f.close();}
});
test('isolated test never changes any real account, demo or outbox rows', async () => {
  const f = fixture(); try {
    const tables = f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name<>'owner_email_tests'").all().map(x => x.name);
    const snapshot = () => JSON.stringify(tables.map(table => f.db.sqlite.prepare(`SELECT * FROM "${table}"`).all())); const before = snapshot(); await f.call(); assert.equal(snapshot(), before);
    const env = {RESEND_API_KEY: config.apiKey, FSP_OWNER_EMAIL_TEST_ENABLED: 'true', FSP_OWNER_EMAIL_TEST_TO: user.email, FSP_SITE_ORIGIN: origin}; const normal = realAccountsConfiguration(env); assert.equal(normal.accountsEnabled, false); assert.equal(normal.emailMode, 'off'); assert.equal(ownerEmailTestConfiguration(env).enabled, true);
  } finally {f.close();}
});
test('UI and route expose no recipient input, startup POST, runtime secret or owner address', () => {
  const panel = readFileSync(new URL('../app/owner/email-test/test-panel.tsx', import.meta.url), 'utf8');
  assert.ok(!panel.includes('FSP_OWNER_EMAIL_TEST_TO')); assert.ok(!panel.includes('RESEND_API_KEY')); assert.ok(!panel.includes(user.email)); assert.ok(!panel.includes('<Input')); assert.ok(panel.includes('attempted'));
  const route = readFileSync(new URL('../app/api/owner/email-test/route.ts', import.meta.url), 'utf8'); assert.ok(route.includes('getChatGPTUser()')); assert.ok(!route.includes('request.headers.get'));
});

test('provider responses are bounded to 16KiB, including absent or misleading content length', async () => {
  for (const headers of [{}, {'content-length':'1'}, {'content-length':'20000'}]) {
    const f=fixture(); try {f.reply=()=>new Response(JSON.stringify({id:'safe-id',extra:'x'.repeat(20000)}),{status:200,headers}); assert.deepEqual(await (await f.call()).json(),{status:'unknown',code:'INVALID_PROVIDER_RESPONSE'}); await f.call();assert.equal(f.calls.length,1);} finally {f.close();}
  }
});
test('redirect and error bodies are cancelled, never read or exposed', async () => {
  for (const status of [302,403,500]) {const f=fixture();let cancelled=false;try {f.reply=()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status});await f.call();assert.equal(cancelled,true);}finally{f.close();}}
});
test('runtime configuration trims credential boundary whitespace without exposing it', () => {
  const value=ownerEmailTestConfiguration({RESEND_API_KEY:'  synthetic-not-a-credential \n',FSP_OWNER_EMAIL_TEST_TO:' OWNER@EXAMPLE.TEST '});assert.equal(value.apiKey,'synthetic-not-a-credential');assert.equal(value.ownerEmail,'owner@example.test');
});
