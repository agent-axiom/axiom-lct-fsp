import { DomainError } from './domain.mjs';

export const GOOGLE_MAIL_TRANSPORT = 'google-mailapp';
export const emailTransport = config => config.emailTransport || 'resend';
const bytes = value => new TextEncoder().encode(value);
const hex = value => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
export async function relayHmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', bytes(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, bytes(value)));
}
export const relayRequestInput = envelope => JSON.stringify(['fsp-mail-request-v1', envelope.timestamp, envelope.nonce, envelope.payload]);
export const relayResponseInput = body => JSON.stringify(['fsp-mail-response-v1', body.nonce, body.payloadHash, body.status, body.code, body.receipt]);
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
};
export function assertTransportConfiguration(config) {
  const transport = emailTransport(config);
  if (transport === 'resend') {
    if ([config.resendApiKey, config.sender].some(value => typeof value !== 'string' || !value.trim())) throw new DomainError('Отправка email не настроена полностью.', 503);
  } else if (transport === GOOGLE_MAIL_TRANSPORT) {
    // A fixed Apps Script deployment URL only. No credentials or secrets in URLs.
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,200}\/exec$/.test(config.googleRelayUrl || '') ||
        !/^[a-f0-9]{64}$/i.test(config.googleRelaySecret || '') ||
        !/^[a-z0-9-]{1,64}$/.test(config.googleRelayAudience || '')) throw new DomainError('Google email ещё не настроен полностью.', 503);
  } else throw new DomainError('Неизвестный транспорт email.', 503);
}
export function verificationPayload(config, challenge, token) {
  const origin = config.siteOrigin.replace(/\/$/, '');
  if (emailTransport(config) === GOOGLE_MAIL_TRANSPORT) return JSON.stringify({
    version: 1, template: 'fsp-email-verification-v1', audience: config.googleRelayAudience,
    idempotencyKey: `fsp-verify-${challenge.id}`, challengeId: challenge.id,
    recipient: challenge.recipient, token, expiresAt: challenge.expires_at, origin,
  });
  const link = `${origin}/account/verify#challenge=${encodeURIComponent(challenge.id)}&token=${token}`;
  return JSON.stringify({from: config.sender, to: [challenge.recipient], subject: 'Подтверждение email · ФСП / ТАЛАНТЫ', text: `Вы запросили подтверждение адреса для своего аккаунта. Откройте ссылку: ${link}\nСсылка действует 15 минут и используется один раз. Если запрос не ваш, проигнорируйте письмо.`});
}
// Preserve existing Resend fingerprints. Google fingerprints additionally pin
// the relay ledger: changing deployment must never re-send an existing job.
export const payloadIdentity = (config, payload) => emailTransport(config) === GOOGLE_MAIL_TRANSPORT
  ? JSON.stringify([GOOGLE_MAIL_TRANSPORT, config.googleRelayUrl, payload]) : payload;

export async function sendVerification(config, job, payload, fetcher, now) {
  const google = emailTransport(config) === GOOGLE_MAIL_TRANSPORT;
  const controller = new AbortController();
  let timeout, errorCode = 'NETWORK_ERROR';
  // No raw exceptions, provider bodies or credentials leave this boundary.
  const unknown = () => ({accepted: false, errorCode: 'DELIVERY_UNKNOWN', retryable: false});
  const expiry = new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 10000); });
  try {
    return await Promise.race([expiry, (async () => {
      if (!google) {
        const response = await fetcher('https://api.resend.com/emails', {method: 'POST', signal: controller.signal, headers: {Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `fsp-verify-${job.challenge_id}`}, body: payload});
        if (!response.ok) return {accepted: false, errorCode: `HTTP_${response.status}`, retryable: response.status >= 500 || [408, 409, 425, 429].includes(response.status)};
        errorCode = 'INVALID_PROVIDER_RESPONSE';
        const body = await response.json();
        return typeof body?.id === 'string' && body.id.trim() ? {accepted: true, providerId: body.id} : {accepted: false, errorCode, retryable: true};
      }
      const envelope = {timestamp: now, nonce: crypto.randomUUID(), payload};
      envelope.signature = await relayHmac(config.googleRelaySecret, relayRequestInput(envelope));
      const hash = hex(await crypto.subtle.digest('SHA-256', bytes(payload)));
      // Apps Script ContentService redirects responses to googleusercontent.
      // Follow only its GET response redirect, never re-POST the signed payload.
      let response = await fetcher(config.googleRelayUrl, {method: 'POST', redirect: 'manual', signal: controller.signal, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(envelope)});
      if ([302, 303].includes(response.status)) {
        const location = response.headers.get('location');
        let url;
        try { url = new URL(location); } catch { return unknown(); }
        if (url.protocol !== 'https:' || url.hostname !== 'script.googleusercontent.com' || url.port || url.username || url.password || url.pathname !== '/macros/echo') return unknown();
        response = await fetcher(url.href, {method: 'GET', redirect: 'error', signal: controller.signal});
      }
      if (!response.ok) return unknown();
      const body = await response.json();
      if (!body || body.nonce !== envelope.nonce || body.payloadHash !== hash ||
          !equal(body.signature, await relayHmac(config.googleRelaySecret, relayResponseInput(body)))) return unknown();
      if (body.status === 'sent' && body.code === 'ACCEPTED' && body.receipt === `google-mailapp:${job.challenge_id}`) return {accepted: true, providerId: body.receipt};
      const known = ['BUSY', 'RATE_LIMIT', 'QUOTA', 'DISABLED', 'NOT_ALLOWED', 'INVALID_PAYLOAD', 'EXPIRED', 'REPLAY', 'KEY_CONFLICT', 'STORAGE_FULL'];
      if (body.status === 'not_sent' && body.receipt === null && known.includes(body.code)) return {accepted: false, errorCode: `RELAY_${body.code}`, retryable: ['BUSY', 'RATE_LIMIT', 'QUOTA'].includes(body.code)};
      return unknown();
    })()]);
  } catch { return google ? unknown() : {accepted: false, errorCode, retryable: true}; }
  finally { clearTimeout(timeout); }
}
