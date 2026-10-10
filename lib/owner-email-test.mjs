import { DomainError } from './domain.mjs';
import { readJsonBody } from './http-body.mjs';

// One event across identities, deployments and provider idempotency expiry.
// Never bump this key to retry an uncertain send.
export const OWNER_EMAIL_TEST_ID = 'fsp-owner-resend-smoke-2026-10-10-v1';
const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'};
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
export function ownerEmailTestConfiguration(env = {}) {
  return {enabled: env.FSP_OWNER_EMAIL_TEST_ENABLED === 'true', ownerEmail: String(env.FSP_OWNER_EMAIL_TEST_TO || '').trim().toLowerCase(), apiKey: typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '', siteOrigin: env.FSP_SITE_ORIGIN || ''};
}
export function isOwnerEmailTestUser(user, config) {
  return Boolean(user && typeof user.userId === 'string' && user.userId.trim() && config.ownerEmail && typeof user.email === 'string' && user.email.trim().toLowerCase() === config.ownerEmail);
}
const payloadFor = config => JSON.stringify({
  from: 'onboarding@resend.dev', to: [config.ownerEmail],
  subject: 'ФСП / ТАЛАНТЫ: проверка почты 10.10.2026',
  text: 'Это одно проверочное письмо владельцу проекта ФСП / ТАЛАНТЫ. Отправка выполнена через Resend. Реальные аккаунты и общая отправка почты остаются выключенными. Это письмо не создаёт аккаунт и не содержит ссылки подтверждения.',
});
function ready(config) {
  if (!config.enabled) throw new DomainError('Проверка почты отключена.', 503);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.ownerEmail) || typeof config.apiKey !== 'string' || !config.apiKey.trim()) throw new DomainError('Проверка почты ещё не настроена.', 503);
  let origin;
  try { origin = new URL(config.siteOrigin); } catch { throw new DomainError('Проверка почты ещё не настроена.', 503); }
  if (origin.protocol !== 'https:' || origin.origin !== config.siteOrigin || origin.username || origin.password) throw new DomainError('Проверка почты ещё не настроена.', 503);
}
const view = (row, now) => row ? {status: row.status === 'sending' && now - row.started_at > 15000 ? 'unknown' : row.status, ...(row.error_code ? {code: row.error_code} : {})} : {status: 'not_started'};
const discard = async response => {try {await response.body?.cancel();} catch {/* No raw response details. */}};
async function providerJson(response, signal) {
  const limit = 16384;
  if (!response.body || Number(response.headers.get('content-length')) > limit) {await discard(response); throw new Error('Invalid response');}
  const reader = response.body.getReader();
  const abort = () => {void reader.cancel().catch(() => {});};
  signal.addEventListener('abort', abort, {once: true});
  if (signal.aborted) abort();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {await reader.cancel(); throw new Error('Invalid response');}
      chunks.push(value);
    }
  } finally {signal.removeEventListener('abort', abort); reader.releaseLock();}
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {body.set(chunk, offset); offset += chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body));
}
async function deliver(config, payload, fetcher, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const expiry = new Promise((_, reject) => {timer = setTimeout(() => {controller.abort(); reject(new Error('timeout'));}, timeoutMs);});
  try {
    return await Promise.race([expiry, (async () => {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: {'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': OWNER_EMAIL_TEST_ID}, body: payload,
      });
      // Workerd supports manual. Never forward the credential on redirects.
      if (response.status >= 300 && response.status < 400) {await discard(response); return {status: 'unknown', code: 'UNEXPECTED_REDIRECT'};}
      if (!response.ok) {await discard(response); return {status: [400, 401, 403, 404, 422, 429].includes(response.status) ? 'rejected' : 'unknown', code: `HTTP_${response.status}`};}
      let body;
      try { body = await providerJson(response, controller.signal); } catch { return {status: 'unknown', code: 'INVALID_PROVIDER_RESPONSE'}; }
      if (typeof body?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(body.id)) return {status: 'unknown', code: 'INVALID_PROVIDER_RESPONSE'};
      return {status: 'accepted', providerId: body.id};
    })()]);
  } catch { return {status: 'unknown', code: 'DELIVERY_UNKNOWN'}; }
  finally {clearTimeout(timer);}
}
/** @param {Request} request
 * @param {{user: {userId:string,email:string}|null, db:any, config:ReturnType<typeof ownerEmailTestConfiguration>, fetcher?:typeof fetch, clock?:()=>number, timeoutMs?:number}} options
 */
export async function handleOwnerEmailTest(request, {user, db, config, fetcher = fetch, clock = Date.now, timeoutMs = 10000}) {
  try {
    // The adapter supplies platform-authenticated fields; request data is never identity.
    if (!user) throw new DomainError('Нужно войти в ChatGPT.', 401);
    if (!isOwnerEmailTestUser(user, config)) throw new DomainError('Нет доступа.', 403);
    const url = new URL(request.url);
    if (url.pathname !== '/api/owner/email-test' || url.search || !['GET', 'POST'].includes(request.method)) throw new DomainError('Не найдено.', 404);
    if (!db) throw new DomainError('Хранилище временно недоступно.', 503);
    const principalHash = await digest(user.userId);
    const read = () => db.prepare('SELECT * FROM owner_email_tests WHERE id=?').bind(OWNER_EMAIL_TEST_ID).first();
    const existing = await read();
    if (existing && existing.principal_hash !== principalHash) throw new DomainError('Нет доступа.', 403);
    if (request.method === 'GET') return Response.json({...view(existing, clock()), enabled: config.enabled}, {headers});
    ready(config);
    if (url.origin !== config.siteOrigin || request.headers.get('origin') !== config.siteOrigin) throw new DomainError('Источник запроса не разрешён.', 403);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new DomainError('Нужен JSON-запрос.', 415);
    const input = await readJsonBody(request, 128);
    if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).length !== 1 || input.action !== 'send-owner-test') throw new DomainError('Запрос не принимает получателя или текст письма.', 400);
    if (existing) return Response.json({...view(existing, clock()), replay: true}, {headers});
    const payload = payloadFor(config);
    // Only the successful INSERT caller may reach the provider. No lease expiry,
    // release, reset, cron or retry can reopen this event, even after a crash.
    const claim = await db.prepare("INSERT INTO owner_email_tests(id,principal_hash,payload_hash,status,started_at) VALUES(?,?,?,'sending',?) ON CONFLICT(id) DO NOTHING").bind(OWNER_EMAIL_TEST_ID, principalHash, await digest(payload), clock()).run();
    if (claim.meta.changes !== 1) {
      const winner = await read();
      if (!winner || winner.principal_hash !== principalHash) throw new DomainError('Нет доступа.', 403);
      return Response.json({...view(winner, clock()), replay: true}, {headers});
    }
    const result = await deliver(config, payload, fetcher, timeoutMs);
    await db.prepare("UPDATE owner_email_tests SET status=?,provider_message_id=?,error_code=?,finished_at=? WHERE id=? AND principal_hash=? AND status='sending'").bind(result.status, result.providerId || null, result.code || null, clock(), OWNER_EMAIL_TEST_ID, principalHash).run();
    return Response.json({status: result.status, ...(result.code ? {code: result.code} : {})}, {headers});
  } catch (error) {
    // Never log or return provider bodies, request payloads, addresses or secrets.
    return Response.json({error: error instanceof DomainError ? error.message : 'Статус проверки недоступен. Не запускайте новое письмо; обновите статус.'}, {status: error instanceof DomainError ? error.status : 503, headers});
  }
}
