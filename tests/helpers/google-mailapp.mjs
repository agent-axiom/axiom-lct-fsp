import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHmac, createHash} from 'node:crypto';
export const relaySecret = 'a'.repeat(64);
export function mailappHarness({now = Date.now(), properties = {}, shared = new Map()} = {}) {
  const settings = {FSP_RELAY_ENABLED: 'true', FSP_RELAY_HMAC_SECRET: relaySecret, FSP_RELAY_SITE_ORIGIN: 'https://example.test', FSP_RELAY_AUDIENCE: 'fsp-pilot', FSP_RELAY_ALLOWED_RECIPIENTS: '["alice@example.test"]', ...properties};
  for (const [key, value] of Object.entries(settings)) shared.set(key, value);
  const h = {now, shared, sent: [], locked: false, quota: 100, beforeWrite: null, afterWrite: null, onSend: null};
  const props = {getProperty: key => shared.get(key) ?? null, getProperties: () => Object.fromEntries(shared), deleteProperty: key => shared.delete(key), setProperty(key, value) { h.beforeWrite?.(key, value); shared.set(key, value); h.afterWrite?.(key, value); }};
  let acquired = false;
  const context = vm.createContext({Date: class extends Date { static now() { return h.now; } }, PropertiesService: {getScriptProperties: () => props}, LockService: {getScriptLock: () => ({tryLock() { if (h.locked) return false; h.locked = acquired = true; return true; }, hasLock: () => acquired, releaseLock() { acquired = h.locked = false; }})}, MailApp: {getRemainingDailyQuota: () => h.quota, sendEmail(mail) { h.sent.push(JSON.parse(JSON.stringify(mail))); h.onSend?.(mail); }}, ContentService: {MimeType: {JSON: 'application/json'}, createTextOutput: text => ({text, setMimeType() { return this; }})}, Utilities: {Charset: {UTF_8: 'utf8'}, DigestAlgorithm: {SHA_256: 'sha256'}, computeDigest: (algorithm, value) => [...createHash('sha256').update(value).digest()], computeHmacSha256Signature: (value, secret) => [...createHmac('sha256', secret).update(value).digest()]}});
  vm.runInContext(readFileSync(new URL('../../integrations/google-mailapp/Code.gs', import.meta.url), 'utf8'), context);
  h.post = body => JSON.parse(context.doPost({postData: {contents: typeof body === 'string' ? body : JSON.stringify(body)}}).text);
  h.get = () => JSON.parse(context.doGet().text);
  h.fetch = async (url, init) => ({ok: true, status: 200, json: async () => h.post(init.body)});
  return h;
}
