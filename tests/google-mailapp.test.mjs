import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {relayHmac, relayRequestInput, relayResponseInput, sendVerification, verificationPayload, assertTransportConfiguration} from '../lib/email-transport.mjs';
import {mailappHarness, relaySecret} from './helpers/google-mailapp.mjs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {realAccountsConfiguration, RealAccountsService} from '../lib/real-accounts.mjs';
import {drainEmailOutbox, dispatchAccountEmail, accountEmailStatus} from '../lib/email-outbox.mjs';
import {handleAccountRequest} from '../lib/real-account-http.mjs';

const config = {accountsEnabled: true, emailMode: 'live', emailTransport: 'google-mailapp', googleRelayUrl: 'https://script.google.com/macros/s/synthetic-deployment-id/exec', googleRelaySecret: relaySecret, googleRelayAudience: 'fsp-pilot', tokenSecret: 'Synthetic-test-only-token-secret-0123456789', siteOrigin: 'https://example.test', privacyNoticeUrl: 'https://example.test/privacy', privacyNoticeVersion: 'test-v1'};
const principal = {issuer: 'test', subject: 'alice'};
const token = 'b'.repeat(64);
const challenge = now => ({id: crypto.randomUUID(), recipient: 'alice@example.test', expires_at: now + 900000});
async function envelope(payload, now) { const body = {timestamp: now, nonce: crypto.randomUUID(), payload: JSON.stringify(payload)}; body.signature = await relayHmac(relaySecret, relayRequestInput(body)); return body; }
const payload = (now, overrides = {}) => ({...JSON.parse(verificationPayload(config, challenge(now), token)), ...overrides});
async function fixture(overrides = {}) {
  const db = sqliteD1(), now = Date.now(), settings = {...config, ...overrides};
  const service = new RealAccountsService(db, settings);
  await service.execute(principal, {action: 'register', role: 'candidate', name: 'Alice Synthetic', email: 'alice@example.test', dataConsent: true, privacyNoticeVersion: 'test-v1'}, now);
  const relay = mailappHarness({now});
  return {db, now, config: settings, relay, service, close: () => db.close(), job: () => db.prepare('SELECT * FROM real_email_outbox').first()};
}
async function signedResult(request, values) {
  const body = {nonce: request.nonce, payloadHash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.payload))), x => x.toString(16).padStart(2, '0')).join(''), status: 'not_sent', code: 'BUSY', receipt: null, ...values};
  body.signature = await relayHmac(relaySecret, relayResponseInput(body)); return body;
}

test('configuration defaults to OFF and Resend; manifest grants only send_mail', () => {
  const result = realAccountsConfiguration(); assert.equal(result.emailMode, 'off'); assert.equal(result.emailTransport, 'resend');
  assert.deepEqual(JSON.parse(readFileSync(new URL('../integrations/google-mailapp/appsscript.json', import.meta.url))).oauthScopes, ['https://www.googleapis.com/auth/script.send_mail']);
  assertTransportConfiguration(config);
});
for (const override of [{emailTransport: 'typo'}, {googleRelayUrl: 'https://evil.test/exec'}, {googleRelayUrl: config.googleRelayUrl + '?secret=x'}, {googleRelayUrl: config.googleRelayUrl.replace('/exec', '/dev')}, {googleRelaySecret: 'short'}, {googleRelayAudience: ''}]) test('bad transport configuration fails closed: ' + Object.keys(override), () => assert.throws(() => assertTransportConfiguration({...config, ...override})));

test('real relay script produces a signed receipt, fixed template and durable redacted ledger', async () => {
  const h = mailappHarness(), p = payload(h.now), request = await envelope(p, h.now), result = h.post(request);
  assert.equal(result.status, 'sent'); assert.equal(result.receipt, 'google-mailapp:' + p.challengeId);
  assert.equal(result.signature, await relayHmac(relaySecret, relayResponseInput(result)));
  assert.equal(h.sent.length, 1); assert.deepEqual(Object.keys(h.sent[0]).sort(), ['body', 'subject', 'to']);
  assert.match(h.sent[0].body, /https:\/\/example\.test\/account\/verify#challenge=/);
  const ledger = JSON.stringify([...h.shared].filter(([key]) => key.startsWith('receipt:') || key.startsWith('nonce:')));
  for (const value of [token, 'alice@example.test', relaySecret]) assert.ok(!ledger.includes(value));
  const restarted = mailappHarness({now: h.now, shared: h.shared});
  assert.equal(restarted.post(await envelope(p, h.now)).status, 'sent'); assert.equal(restarted.sent.length, 0);
  assert.equal(h.post(request).code, 'REPLAY'); assert.equal(h.sent.length, 1);
});

test('valid signed payload change under same idempotency key never sends twice', async () => {
  const h = mailappHarness(), p = payload(h.now); h.post(await envelope(p, h.now));
  assert.equal(h.post(await envelope({...p, token: 'c'.repeat(64)}, h.now)).code, 'KEY_CONFLICT'); assert.equal(h.sent.length, 1);
});
for (const [label, change] of [
  ['recipient not allowlisted', {recipient: 'other@example.test'}], ['header injection', {recipient: 'alice@example.test\r\nBcc:evil@example.test'}], ['multiple recipients', {recipient: 'alice@example.test,evil@example.test'}],
  ['arbitrary subject', {subject: 'Phishing'}], ['arbitrary body', {body: 'Phishing'}], ['wrong template', {template: 'newsletter'}], ['cross-app audience', {audience: 'other-app'}], ['arbitrary link', {origin: 'https://evil.test'}],
  ['expired link', {expiresAt: 1}], ['long-lived link', {expiresAt: Number.MAX_SAFE_INTEGER}], ['malformed token', {token: 'https://evil.test'}], ['invalid challenge', {challengeId: '../path'}], ['unbound key', {idempotencyKey: 'other-key'}],
]) test('relay rejects ' + label, async () => { const h = mailappHarness(); const r = h.post(await envelope(payload(h.now, change), h.now)); assert.equal(r.status, 'not_sent'); assert.equal(h.sent.length, 0); });

test('invalid authentication, stale/future timestamps and oversized input never send', async () => {
  const h = mailappHarness(), p = payload(h.now), good = await envelope(p, h.now);
  assert.deepEqual(h.get(), {error: 'REJECTED'});
  for (const request of [{...good, signature: '0'.repeat(64)}, {...good, payload: good.payload + ' '}, {...good, extra: true}, 'x'.repeat(9000), '{']) h.post(request);
  for (const timestamp of [h.now - 300001, h.now + 300001]) assert.equal(h.post(await envelope(p, timestamp)).code, 'EXPIRED');
  assert.equal(h.sent.length, 0);
});
for (const [name, settings] of [['OFF', {FSP_RELAY_ENABLED: 'false'}], ['missing switch', {FSP_RELAY_ENABLED: ''}], ['51 limit', {FSP_RELAY_ROLLING_24H_LIMIT: '51'}], ['invalid limit', {FSP_RELAY_ROLLING_24H_LIMIT: 'NaN'}], ['empty allowlist', {FSP_RELAY_ALLOWED_RECIPIENTS: '[]'}], ['over 10 recipients', {FSP_RELAY_ALLOWED_RECIPIENTS: JSON.stringify(Array.from({length: 11}, (_, i) => `p${i}@example.test`))}], ['wildcard address', {FSP_RELAY_ALLOWED_RECIPIENTS: '["*@example.test"]'}]]) test('relay configuration rejects ' + name, async () => { const h = mailappHarness({properties: settings}); assert.equal(h.post(await envelope(payload(h.now), h.now)).status, 'not_sent'); assert.equal(h.sent.length, 0); });

test('rolling 24-hour cap defaults to 20, counts unknown reservations, and has no midnight reset', async () => {
  const now = Date.UTC(2026, 9, 9, 23, 59), h = mailappHarness({now});
  h.onSend = () => { throw new Error('ambiguous quota error with secret'); };
  for (let i = 0; i < 20; i++) assert.equal(h.post(await envelope(payload(h.now), h.now)).status, 'unknown');
  h.now += 120000;
  assert.equal(h.post(await envelope(payload(h.now), h.now)).code, 'RATE_LIMIT'); assert.equal(h.sent.length, 20);
  h.now = now + 24 * 3600000;
  assert.equal(h.post(await envelope(payload(h.now), h.now)).status, 'unknown'); assert.equal(h.sent.length, 21);
});
test('hard ceiling 50 and allowlist of 10 are accepted explicitly', async () => {
  const h = mailappHarness({properties: {FSP_RELAY_ROLLING_24H_LIMIT: '50', FSP_RELAY_ALLOWED_RECIPIENTS: JSON.stringify(['alice@example.test', ...Array.from({length: 9}, (_, i) => `p${i}@example.test`)])}});
  for (let i = 0; i < 50; i++) assert.equal(h.post(await envelope(payload(h.now), h.now)).status, 'sent');
  assert.equal(h.post(await envelope(payload(h.now), h.now)).code, 'RATE_LIMIT'); assert.equal(h.sent.length, 50);
});
test('provider quota and lock contention return signed safe rejections', async () => {
  const h = mailappHarness(), p = payload(h.now); h.quota = 0;
  assert.equal(h.post(await envelope(p, h.now)).code, 'QUOTA'); h.locked = true;
  assert.equal(h.post(await envelope(p, h.now)).code, 'BUSY'); assert.equal(h.sent.length, 0);
});
for (const phase of ['before reservation', 'after reservation', 'after send', 'before sent receipt']) test('relay crash ' + phase + ' cannot cause duplicate mail', async () => {
  const h = mailappHarness(), p = payload(h.now);
  h.beforeWrite = (key, value) => { if (key.startsWith('receipt:') && ((phase === 'before reservation' && value.includes('unknown')) || (phase === 'before sent receipt' && value.includes('sent')))) throw new Error('secret storage failure'); };
  h.afterWrite = (key, value) => { if (phase === 'after reservation' && key.startsWith('receipt:') && value.includes('unknown')) throw new Error('secret crash'); };
  h.onSend = () => { if (phase === 'after send') throw new Error('secret send failure'); };
  const r = h.post(await envelope(p, h.now)); assert.equal(r.status, 'unknown'); assert.ok(!JSON.stringify(r).includes('secret'));
  h.beforeWrite = h.afterWrite = h.onSend = null;
  const retry = h.post(await envelope(p, h.now));
  assert.equal(retry.status, phase === 'before reservation' ? 'sent' : 'unknown'); assert.ok(h.sent.length <= 1);
});
test('durable receipt capacity fails closed without eviction', async () => {
  const h = mailappHarness();
  for (let i = 0; i < 1000; i++) h.shared.set('receipt:' + i, JSON.stringify({hash: 'c'.repeat(64), state: 'unknown', at: h.now - 25 * 3600000}));
  assert.equal(h.post(await envelope(payload(h.now), h.now)).code, 'STORAGE_FULL'); assert.equal(h.sent.length, 0); assert.equal([...h.shared.keys()].filter(x => x.startsWith('receipt:')).length, 1000);
});

test('outbox integrates with actual relay script and pins transport without exposing secrets', async () => {
  const f = await fixture(); try {
    assert.equal((await drainEmailOutbox(f.db, f.config, {now: f.now, fetcher: f.relay.fetch})).sent, 1);
    const job = await f.job(); assert.equal(job.email_transport, 'google-mailapp'); assert.equal(job.status, 'sent'); assert.match(job.provider_message_id, /^google-mailapp:/);
    await drainEmailOutbox(f.db, f.config, {now: f.now + 1, fetcher: f.relay.fetch}); assert.equal(f.relay.sent.length, 1);
    assert.equal((await f.db.prepare('SELECT email_verified_at FROM real_accounts').first()).email_verified_at, null);
    const dto = await f.service.state(principal, f.now);
    for (const value of [relaySecret, config.googleRelayUrl, 'signature', 'payload_hash', 'email_transport']) assert.ok(!JSON.stringify(dto).includes(value));
  } finally { f.close(); }
});
for (const [label, fetcher] of [
  ['network loss', async () => { throw new Error('secret provider body'); }], ['HTTP 503', async () => ({ok: false, status: 503})], ['unsigned success', async () => ({ok: true, status: 200, json: async () => ({id: 'forged'})})], ['invalid JSON', async () => ({ok: true, status: 200, json: async () => { throw new Error('token secret'); }})],
  ['forged signature', async (url, input) => ({ok: true, status: 200, json: async () => ({...await signedResult(JSON.parse(input.body), {}), signature: '0'.repeat(64)})})],
  ['signed unknown', async (url, input) => ({ok: true, status: 200, json: async () => signedResult(JSON.parse(input.body), {status: 'unknown', code: 'DELIVERY_UNKNOWN'})})],
]) test('outbox ' + label + ' is persistently unknown, never retried', async () => {
  const f = await fixture(); try {
    let calls = 0; const transport = (...args) => { calls++; return fetcher(...args); };
    await drainEmailOutbox(f.db, f.config, {now: f.now, fetcher: transport});
    const job = await f.job(); assert.equal(job.status, 'failed'); assert.equal(job.last_error_code, 'DELIVERY_UNKNOWN');
    const status = await f.service.state(principal, f.now + 61000); assert.equal(status.emailStatus, 'unknown'); assert.equal(status.emailRetryAllowed, false);
    await dispatchAccountEmail(f.db, f.config, {principal, challengeId: job.challenge_id, clock: () => f.now + 61000, fetcher: transport});
    await drainEmailOutbox(f.db, f.config, {now: f.now + 61000, fetcher: transport}); assert.equal(calls, 1);
  } finally { f.close(); }
});
test('signed BUSY safely retries same payload with fresh nonce, then sends once', async () => {
  const f = await fixture(); try {
    f.relay.locked = true;
    await drainEmailOutbox(f.db, f.config, {now: f.now, fetcher: f.relay.fetch}); assert.equal((await f.job()).status, 'retry');
    f.relay.locked = false; f.relay.now += 61000;
    assert.equal((await drainEmailOutbox(f.db, f.config, {now: f.relay.now, fetcher: f.relay.fetch})).sent, 1); assert.equal(f.relay.sent.length, 1);
  } finally { f.close(); }
});
test('worker crash after relay acceptance expires into UNKNOWN without resend', async () => {
  const f = await fixture(); try {
    f.db.failOnceWhen = /UPDATE real_email_outbox SET status='sent'/;
    await assert.rejects(drainEmailOutbox(f.db, f.config, {now: f.now, fetcher: f.relay.fetch})); assert.equal((await f.job()).status, 'leased');
    const account = await f.db.prepare('SELECT * FROM real_accounts').first();
    const dto = await accountEmailStatus(f.db, account, f.config, f.now + 61000); assert.equal(dto.emailStatus, 'unknown'); assert.equal(dto.emailRetryAllowed, false);
    await drainEmailOutbox(f.db, f.config, {now: f.now + 61000, fetcher: f.relay.fetch}); assert.equal(f.relay.sent.length, 1); assert.equal((await f.job()).last_error_code, 'DELIVERY_UNKNOWN');
  } finally { f.close(); }
});
test('provider/relay deployment changes fail closed before transport', async () => {
  for (const overrides of [{emailTransport: 'resend', sender: 'verify@example.test', resendApiKey: 'synthetic'}, {googleRelayUrl: config.googleRelayUrl.replace('synthetic-deployment', 'another-deployment')}]) {
    const f = await fixture(); try { let calls = 0; await drainEmailOutbox(f.db, {...f.config, ...overrides}, {now: f.now, fetcher: async () => { calls++; }}); assert.equal(calls, 0); assert.equal((await f.job()).status, 'failed'); } finally { f.close(); }
  }
});
test('Google OFF and foreign owner never reach transport', async () => {
  const f = await fixture(); try {
    let calls = 0; const fetcher = async () => { calls++; };
    await drainEmailOutbox(f.db, {emailMode: 'off'}, {fetcher});
    await assert.rejects(dispatchAccountEmail(f.db, f.config, {principal: {...principal, subject: 'mallory'}, challengeId: (await f.job()).challenge_id, fetcher}), error => error.status === 403); assert.equal(calls, 0);
  } finally { f.close(); }
});
test('HTTP registration dispatches Google, request JSON cannot choose target or cross owner', async () => {
  const db = sqliteD1(), now = Date.now(), h = mailappHarness({now});
  const request = input => new Request('https://example.test/api/account/action', {method: 'POST', headers: {origin: 'https://example.test', 'content-type': 'application/json'}, body: JSON.stringify(input)});
  try {
    const result = await handleAccountRequest(request({action: 'register', role: 'candidate', name: 'Alice Synthetic', email: 'alice@example.test', dataConsent: true, privacyNoticeVersion: 'test-v1'}), {principal, db, config, clock: () => now, emailFetcher: h.fetch});
    assert.equal(result.status, 200); assert.equal((await result.json()).emailStatus, 'sent'); assert.equal(h.sent.length, 1);
    for (const action of ['email-request', 'email-retry']) assert.equal((await handleAccountRequest(request({action, recipient: 'evil@example.test'}), {principal, db, config, clock: () => now, emailFetcher: h.fetch})).status, 400);
    assert.equal(h.sent.length, 1);
  } finally { db.close(); }
});
test('Apps Script redirect follows only GET on exact Google response host', async () => {
  const now = Date.now(), c = challenge(now), p = verificationPayload(config, c, token), h = mailappHarness({now}); let body, calls = [];
  const fetcher = async (url, input) => { calls.push({url, input}); if (calls.length === 1) {body = input.body; return {status: 302, headers: new Headers({location: 'https://script.googleusercontent.com/macros/echo?test=synthetic'})}; } return {ok: true, status: 200, json: async () => h.post(body)}; };
  assert.equal((await sendVerification(config, {challenge_id: c.id}, p, fetcher, now)).accepted, true);
  assert.equal(calls[1].input.method, 'GET'); assert.equal(calls[1].input.body, undefined); assert.equal(calls[1].input.headers, undefined);
  for (const location of ['https://evil.test/macros/echo', 'https://script.googleusercontent.com.evil.test/macros/echo', 'http://script.googleusercontent.com/macros/echo', 'https://user:secret@script.googleusercontent.com/macros/echo']) {
    let n = 0; const result = await sendVerification(config, {challenge_id: c.id}, p, async () => { n++; return {status: 302, headers: new Headers({location})}; }, now); assert.equal(result.errorCode, 'DELIVERY_UNKNOWN'); assert.equal(n, 1);
  }
});
test('timeout and late provider completion remain UNKNOWN with no automatic replay', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = await fixture(); try {
    let started, release; const sent = new Promise(resolve => { started = resolve; }), response = new Promise(resolve => { release = resolve; });
    const pending = drainEmailOutbox(f.db, f.config, {now: f.now, fetcher: async (url, input) => { const result = f.relay.post(input.body); started(); await response; return {ok: true, status: 200, json: async () => result}; }});
    await sent; t.mock.timers.tick(10001); await pending; assert.equal((await f.job()).last_error_code, 'DELIVERY_UNKNOWN'); release();
    await drainEmailOutbox(f.db, f.config, {now: f.now + 61000, fetcher: f.relay.fetch}); assert.equal(f.relay.sent.length, 1); assert.equal((await f.job()).status, 'failed');
  } finally { f.close(); }
});

test('additive transport migration preserves populated data and pins legacy jobs to Resend', async () => {
  const f = await fixture({emailTransport: 'resend', resendApiKey: 'synthetic', sender: 'verify@example.test'});
  try {
    f.db.sqlite.exec('ALTER TABLE real_email_outbox DROP COLUMN email_transport');
    const tables = f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    const before = Object.fromEntries(tables.map(table => [table, f.db.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
    f.db.sqlite.exec(readFileSync(new URL('../drizzle/0005_email_transport.sql', import.meta.url), 'utf8'));
    for (const table of tables) {
      const rows = f.db.sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (table === 'real_email_outbox') for (const row of rows) { assert.equal(row.email_transport, 'resend'); delete row.email_transport; }
      assert.deepEqual(rows, before[table]);
    }
    let calls = 0; await drainEmailOutbox(f.db, config, {now: f.now, fetcher: async () => { calls++; }}); assert.equal(calls, 0); assert.equal((await f.job()).last_error_code, 'TRANSPORT_CHANGED');
  } finally { f.close(); }
});
test('overlapping Google workers and a late response cannot re-send the same job', async () => {
  const f = await fixture(); try {
    let started, finish; const sending = new Promise(resolve => { started = resolve; }), released = new Promise(resolve => { finish = resolve; });
    const first = drainEmailOutbox(f.db, f.config, {now: f.now, fetcher: async (url, input) => { const result = f.relay.post(input.body); started(); await released; return {ok: true, status: 200, json: async () => result}; }});
    await sending;
    assert.equal((await drainEmailOutbox(f.db, f.config, {now: f.now + 1, fetcher: f.relay.fetch})).processed, 0);
    await drainEmailOutbox(f.db, f.config, {now: f.now + 61000, fetcher: f.relay.fetch}); finish(); await first;
    assert.equal(f.relay.sent.length, 1); assert.equal((await f.job()).last_error_code, 'DELIVERY_UNKNOWN');
  } finally { f.close(); }
});
for (const change of [{nonce: 'other-nonce'}, {payloadHash: '0'.repeat(64)}, {receipt: 'google-mailapp:another-challenge'}, {code: 'UNRECOGNIZED'}]) test('signed cross-request or invalid response cannot mark delivery: ' + Object.keys(change), async () => {
  const f = await fixture(); try {
    await drainEmailOutbox(f.db, f.config, {now: f.now, fetcher: async (url, input) => ({ok: true, status: 200, json: async () => signedResult(JSON.parse(input.body), {status: 'sent', code: 'ACCEPTED', receipt: 'google-mailapp:' + JSON.parse(JSON.parse(input.body).payload).challengeId, ...change})})});
    assert.equal((await f.job()).last_error_code, 'DELIVERY_UNKNOWN'); assert.equal((await f.db.prepare('SELECT delivery_state FROM real_email_challenges').first()).delivery_state, 'pending');
  } finally { f.close(); }
});
test('future-skewed nonce remains a replay tombstone for its entire valid timestamp window', async () => {
  const h = mailappHarness(), p = payload(h.now), request = await envelope(p, h.now + 240000);
  assert.equal(h.post(request).status, 'sent'); h.now += 480000;
  assert.equal(h.post(request).code, 'REPLAY'); assert.equal(h.sent.length, 1);
});
test('malformed durable ledger fails closed, with no raw exception or recipient in response', async () => {
  const h = mailappHarness(); h.shared.set('receipt:broken', '{');
  const result = h.post(await envelope(payload(h.now), h.now)); assert.equal(result.status, 'unknown'); assert.equal(h.sent.length, 0);
  assert.ok(!JSON.stringify(result).includes('alice@example.test'));
});
test('relay receipt remains UNKNOWN after restart and a fresh signed request', async () => {
  const h = mailappHarness(), p = payload(h.now); h.onSend = () => { throw new Error('ambiguous'); };
  assert.equal(h.post(await envelope(p, h.now)).status, 'unknown');
  const restarted = mailappHarness({now: h.now, shared: h.shared});
  assert.equal(restarted.post(await envelope(p, h.now)).status, 'unknown'); assert.equal(restarted.sent.length, 0); assert.equal(h.sent.length, 1);
});

test('relay rejects missing token and non-string token/challenge fields', async () => {
  const h = mailappHarness();
  for (const override of [{token: undefined}, {token: [token]}, {challengeId: [crypto.randomUUID()]}]) {
    const p = payload(h.now, override);
    assert.equal(h.post(await envelope(p, h.now)).status, 'not_sent');
  }
  assert.equal(h.sent.length, 0);
});
test('relay refuses a non-string nonce even with a valid signature', async () => {
  const h = mailappHarness(), p = payload(h.now), body = await envelope(p, h.now);
  body.nonce = [body.nonce]; body.signature = await relayHmac(relaySecret, relayRequestInput(body));
  assert.deepEqual(h.post(body), {error: 'REJECTED'}); assert.equal(h.sent.length, 0);
});
