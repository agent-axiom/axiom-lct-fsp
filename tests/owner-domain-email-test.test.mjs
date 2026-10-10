import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {handleOwnerDomainEmailTest, OWNER_DOMAIN_EMAIL_TEST_ID, OWNER_DOMAIN_EMAIL_TEST_FROM} from '../lib/owner-domain-email-test.mjs';
import {handleOwnerEmailTest, ownerEmailTestConfiguration, OWNER_EMAIL_TEST_ID} from '../lib/owner-email-test.mjs';
import {realAccountsConfiguration} from '../lib/real-accounts.mjs';
const origin = 'https://fsp.example.test';
const user = {userId: 'synthetic-owner', email: 'owner@example.test'};
const config = {enabled: true, ownerEmail: user.email, apiKey: 'synthetic-not-a-credential', siteOrigin: origin};
const accepted = () => new Response(JSON.stringify({id: 'synthetic-provider-message'}), {status: 200});
const request = (body = {action: 'send-owner-domain-test'}, options = {}) => new Request(`${origin}/api/owner/domain-email-test`, {method: 'POST', headers: {origin, 'content-type': 'application/json', ...options.headers}, body: JSON.stringify(body), ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'headers'))});
function fixture() {
  const db = sqliteD1(); let now = Date.now(); const calls = [];
  const f = {db, calls, close: () => db.close(), reply: accepted, advance: n => {now += n;}};
  f.call = (req = request(), extra = {}) => handleOwnerDomainEmailTest(req, {user, db, config, clock: () => now, fetcher: async (...args) => {calls.push(args); return f.reply(...args);}, ...extra});
  f.row = () => db.prepare('SELECT * FROM owner_email_tests WHERE id=?').bind(OWNER_DOMAIN_EMAIL_TEST_ID).first();
  return f;
}
test('one accepted message, fixed target/payload, manual redirects and runtime-only secret', async () => {
  const f = fixture(); try {
    assert.deepEqual(await (await f.call()).json(), {status: 'accepted'});
    const [url, init] = f.calls[0]; assert.equal(url, 'https://api.resend.com/emails'); assert.equal(init.redirect, 'manual'); assert.equal(init.headers['Authorization'], `Bearer ${config.apiKey}`); assert.equal(init.headers['Idempotency-Key'], OWNER_DOMAIN_EMAIL_TEST_ID);
    const payload = JSON.parse(init.body); assert.deepEqual(payload.to, [user.email]); assert.equal(payload.from, OWNER_DOMAIN_EMAIL_TEST_FROM); assert.equal(Object.keys(payload).sort().join(), 'from,subject,text,to');
    const row = await f.row(); assert.equal(row.status, 'accepted'); assert.equal(row.provider_message_id, 'synthetic-provider-message'); assert.match(row.principal_hash, /^[a-f0-9]{64}$/); assert.match(row.payload_hash, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(row).includes(user.email)); assert.ok(!JSON.stringify(row).includes(config.apiKey)); assert.ok(!JSON.stringify(row).includes(user.userId));
  } finally {f.close();}
});
test('replay, GET, page refresh and provider 24h expiry cannot resend', async () => {
  const f = fixture(); try {await f.call(); f.advance(3 * 86400000); assert.equal((await (await f.call()).json()).replay, true); const r = await f.call(new Request(`${origin}/api/owner/domain-email-test`)); assert.equal(r.headers.get('Cache-Control'), 'no-store'); assert.deepEqual(await r.json(), {status: 'accepted', enabled: true}); assert.equal(f.calls.length, 1);} finally {f.close();}
});
test('missing, empty or wrong platform identity cannot read, claim or send', async () => {
  const f = fixture(); try {for (const forged of [null, {userId: '', email: user.email}, {userId: 'other', email: 'other@example.test'}]) {assert.ok([401, 403].includes((await f.call(request(), {user: forged})).status));} assert.equal(await f.row(), null); assert.equal(f.calls.length, 0);} finally {f.close();}
});
test('same approved email on another Site identity cannot reopen or read first claim', async () => {
  const f = fixture(); try {await f.call(); for (const req of [request(), new Request(`${origin}/api/owner/domain-email-test`)]) assert.equal((await f.call(req, {user: {...user, userId: 'another-identity'}})).status, 403); assert.equal(f.calls.length, 1);} finally {f.close();}
});
test('cross-origin, missing Origin, wrong host, input overrides, query parameters and malformed requests fail before claim', async () => {
  const f = fixture(); try {
    const invalid = [request(undefined, {headers: {origin: 'https://evil.example'}}), request(undefined, {headers: {origin: ''}}), request({action: 'send-owner-domain-test', to: 'other@example.test'}), request({action: 'send-owner-domain-test', from: 'other@example.test'}), request({action: 'send-owner-domain-test', eventId: OWNER_EMAIL_TEST_ID}), request({action: 'send-owner-test'}), request({action: 'send-owner-domain-test', user}), request([]), request('send-owner-domain-test'), request({action: 'send-owner-domain-test', body: 'custom'}), request(undefined, {headers: {'content-type': 'text/plain'}}), new Request(`${origin}/api/owner/domain-email-test?send=1`, {method: 'POST', body: '{}'}), new Request('https://wrong.example/api/owner/domain-email-test', {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: '{"action":"send-owner-domain-test"}'}), new Request(`${origin}/api/owner/domain-email-test`, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: '{'})];
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
  const panel = readFileSync(new URL('../app/owner/domain-email-test/test-panel.tsx', import.meta.url), 'utf8');
  assert.ok(!panel.includes('FSP_OWNER_EMAIL_TEST_TO')); assert.ok(!panel.includes('RESEND_API_KEY')); assert.ok(!panel.includes(user.email)); assert.ok(!panel.includes('<Input')); assert.ok(panel.includes('attempted'));
  const route = readFileSync(new URL('../app/api/owner/domain-email-test/route.ts', import.meta.url), 'utf8'); assert.ok(route.includes('getChatGPTUser()')); assert.ok(!route.includes('request.headers.get'));
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

for (const oldStatus of ['accepted', 'rejected', 'unknown', 'sending']) test(`prior ${oldStatus} onboarding receipt is preserved byte-for-byte; neither event reopens`, async () => {
  const f = fixture(); try {
    // This is a synthetic prior receipt, never an actual provider call.
    const principalHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user.userId))), b => b.toString(16).padStart(2, '0')).join('');
    await f.db.prepare('INSERT INTO owner_email_tests(id,principal_hash,payload_hash,status,provider_message_id,error_code,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?)').bind(OWNER_EMAIL_TEST_ID, principalHash, 'old-payload-hash', oldStatus, 'old-provider-id', oldStatus === 'unknown' ? 'DELIVERY_UNKNOWN' : null, 123, 456).run();
    const readOld = () => f.db.prepare('SELECT * FROM owner_email_tests WHERE id=?').bind(OWNER_EMAIL_TEST_ID).first();
    const before = JSON.stringify(await readOld());
    assert.notEqual(OWNER_DOMAIN_EMAIL_TEST_ID, OWNER_EMAIL_TEST_ID);
    assert.deepEqual(await (await f.call()).json(), {status: 'accepted'});
    assert.equal(JSON.stringify(await readOld()), before);
    f.advance(3 * 86400000);
    assert.equal((await (await f.call()).json()).replay, true);
    assert.equal(JSON.stringify(await readOld()), before);
    let oldTransportCalls = 0;
    const oldRequest = new Request(`${origin}/api/owner/email-test`, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify({action: 'send-owner-test'})});
    const oldResult = await handleOwnerEmailTest(oldRequest, {user, db: f.db, config, fetcher: async () => {oldTransportCalls++; return accepted();}});
    assert.equal((await oldResult.json()).replay, true);
    assert.equal(oldTransportCalls, 0);
    assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(await readOld()), before);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM owner_email_tests').first()).n, 2);
  } finally {f.close();}
});
test('domain provider ambiguity cannot mutate the earlier onboarding receipt', async () => {
  const f = fixture(); try {
    await f.db.prepare('INSERT INTO owner_email_tests(id,principal_hash,payload_hash,status,started_at) VALUES(?,?,?,?,?)').bind(OWNER_EMAIL_TEST_ID, 'previous-principal-hash', 'previous-payload-hash', 'accepted', 123).run();
    const before = JSON.stringify(await f.db.prepare('SELECT * FROM owner_email_tests WHERE id=?').bind(OWNER_EMAIL_TEST_ID).first());
    f.reply = () => {throw new Error('PRIVATE_PROVIDER_SENTINEL');};
    assert.equal((await (await f.call()).json()).status, 'unknown');
    await f.call();
    assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(await f.db.prepare('SELECT * FROM owner_email_tests WHERE id=?').bind(OWNER_EMAIL_TEST_ID).first()), before);
  } finally {f.close();}
});
test('sender, event and transport are not configurable by request or runtime extras', async () => {
  const f = fixture(); try {
    assert.equal(OWNER_DOMAIN_EMAIL_TEST_FROM, 'noreply@notify.kosarevsky.dev');
    await f.call(request(), {config: {...config, from: 'attacker@example.test', eventId: 'different', endpoint: 'https://attacker.example'}});
    const [url, init] = f.calls[0];
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(JSON.parse(init.body).from, OWNER_DOMAIN_EMAIL_TEST_FROM);
    assert.equal(init.headers['Idempotency-Key'], OWNER_DOMAIN_EMAIL_TEST_ID);
  } finally {f.close();}
});
test('forged identity headers and cookies do not supply missing trusted identity', async () => {
  const f = fixture(); try {
    const req = request(undefined, {headers: {'oai-authenticated-user-id': user.userId, 'oai-authenticated-user-email': user.email, cookie: 'fsp_actor=synthetic-owner'}});
    assert.equal((await f.call(req, {user: null})).status, 401);
    assert.equal(await f.row(), null); assert.equal(f.calls.length, 0);
  } finally {f.close();}
});
test('two requests that both read no receipt race at INSERT; only one can send', async () => {
  const f = fixture(); const prepare = f.db.prepare.bind(f.db);
  let release; const bothRead = new Promise(resolve => {release = resolve;}); let initialReads = 0;
  try {
    f.db.prepare = sql => {
      const statement = prepare(sql);
      if (sql === 'SELECT * FROM owner_email_tests WHERE id=?') {
        const first = statement.first;
        statement.first = async () => {
          const snapshot = await first();
          if (initialReads < 2) {initialReads++; if (initialReads === 2) release(); await bothRead;}
          return snapshot;
        };
      }
      return statement;
    };
    const results = await Promise.all([f.call(), f.call()]);
    const payloads = await Promise.all(results.map(result => result.json()));
    assert.equal(f.calls.length, 1);
    assert.equal(payloads.filter(value => value.replay).length, 1);
    assert.equal((await f.row()).status, 'accepted');
  } finally {release(); f.close();}
});
test('lost acknowledgement of a durable INSERT fails closed without contacting provider', async () => {
  const f = fixture(); const prepare = f.db.prepare.bind(f.db);
  try {
    f.db.prepare = sql => {
      const statement = prepare(sql);
      if (sql.startsWith('INSERT INTO owner_email_tests')) {
        const run = statement.run;
        statement.run = async () => {await run(); throw new Error('PRIVATE_STORAGE_SENTINEL');};
      }
      return statement;
    };
    const response = await f.call();
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('PRIVATE_STORAGE_SENTINEL'));
    assert.equal((await f.row()).status, 'sending');
    f.advance(20000);
    assert.deepEqual(await (await f.call()).json(), {status: 'unknown', replay: true});
    assert.equal(f.calls.length, 0);
  } finally {f.close();}
});
