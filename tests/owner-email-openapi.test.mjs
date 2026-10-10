import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {handleOwnerEmailTest} from '../lib/owner-email-test.mjs';
import {handleOwnerDomainEmailTest} from '../lib/owner-domain-email-test.mjs';
const api = JSON.parse(readFileSync(new URL('../docs/openapi.json', import.meta.url), 'utf8'));
const dereference = ref => ref.split('/').slice(1).reduce((value, key) => value[key], api);
function matches(value, schema) {
  if (schema.$ref) return matches(value, dereference(schema.$ref));
  assert.equal(typeof value, schema.type);
  if (schema.const !== undefined) assert.equal(value, schema.const);
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (schema.pattern) assert.match(value, new RegExp(schema.pattern));
  if (schema.type === 'object') {
    for (const required of schema.required || []) assert.ok(Object.hasOwn(value, required));
    for (const [key, field] of Object.entries(value)) {
      if (schema.additionalProperties === false) assert.ok(Object.hasOwn(schema.properties, key));
      if (schema.properties[key]) matches(field, schema.properties[key]);
    }
  }
}
test('OpenAPI local references resolve and operation IDs are unique', () => {
  const operations = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref?.startsWith('#/')) assert.ok(dereference(value.$ref), value.$ref);
    if (value.operationId) {assert.ok(!operations.has(value.operationId)); operations.add(value.operationId);}
    for (const child of Object.values(value)) visit(child);
  }
  visit(api);
});
for (const [path, action, handle, requestSchema] of [
  ['/api/owner/email-test', 'send-owner-test', handleOwnerEmailTest, 'OwnerEmailTestRequest'],
  ['/api/owner/domain-email-test', 'send-owner-domain-test', handleOwnerDomainEmailTest, 'OwnerDomainEmailTestRequest'],
]) test(`${path} documents bounded actions, errors and actual sanitized responses`, async () => {
  const operation = api.paths[path]; const schema = api.components.schemas[requestSchema];
  assert.deepEqual(Object.keys(operation).sort(), ['get', 'post']);
  assert.deepEqual(schema.required, ['action']); assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), ['action']); assert.equal(schema.properties.action.const, action);
  assert.deepEqual(Object.keys(operation.post.responses).sort(), ['200', '400', '401', '403', '404', '413', '415', '503']);
  assert.deepEqual(operation.post['x-platform-authentication'], {required: true, clientSuppliedIdentityAccepted: false});
  const db = sqliteD1(); const origin = 'https://fsp.example.test';
  const user = {userId: 'synthetic-owner', email: 'owner@example.test'};
  const config = {enabled: true, ownerEmail: user.email, apiKey: 'synthetic-not-a-credential', siteOrigin: origin};
  let calls = 0;
  const options = {user, db, config, fetcher: async () => {calls++; return new Response('{"id":"synthetic-provider-id"}');}};
  const post = (body = {action}) => new Request(origin + path, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  async function check(request, extra = {}) {
    const response = await handle(request, {...options, ...extra});
    const contract = operation[request.method.toLowerCase()].responses[String(response.status)];
    assert.ok(contract, `Undocumented HTTP status: ${response.status}`);
    for (const [header, definition] of Object.entries(contract.headers)) assert.equal(response.headers.get(header), definition.schema.const);
    matches(await response.json(), contract.content['application/json'].schema);
    return response.status;
  }
  try {
    assert.equal(await check(new Request(origin + path)), 200); assert.equal(calls, 0);
    assert.equal(await check(new Request(origin + path), {config: {...config, enabled: false, apiKey: '', siteOrigin: ''}}), 200); assert.equal(calls, 0);
    assert.equal(await check(post(), {user: null}), 401);
    assert.equal(await check(post(), {user: {...user, email: 'other@example.test'}}), 403);
    assert.equal(await check(post({action, to: 'other@example.test'})), 400);
    assert.equal(await check(new Request(origin + path + '?send=1')), 404);
    assert.equal(await check(post({action, extra: 'x'.repeat(200)})), 413);
    assert.equal(await check(new Request(origin + path, {method: 'POST', headers: {origin, 'content-type': 'text/plain'}, body: JSON.stringify({action})})), 415);
    assert.equal(await check(post(), {config: {...config, enabled: false}}), 503);
    assert.equal(await check(post()), 200);
    assert.equal(await check(post()), 200);
    assert.equal(await check(new Request(origin + path)), 200);
    assert.equal(calls, 1);
  } finally {db.close();}
});
