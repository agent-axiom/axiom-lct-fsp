/* FSP send-only pilot. Install manually after owner approval. No inbox scopes.
 * Script Properties are the durable ledger. Never erase them or clone a live
 * deployment to retry mail. Unknown receipts are permanent tombstones.
 */
var FSP_WINDOW_MS = 24 * 60 * 60 * 1000;
var FSP_MAX_SKEW_MS = 5 * 60 * 1000;
var FSP_MAX_RECEIPTS = 1000;
var FSP_MAX_NONCES = 1000;

function fspHex_(values) { return values.map(function (value) { return ('0' + (value & 255).toString(16)).slice(-2); }).join(''); }
function fspHash_(value) { return fspHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)); }
function fspHmac_(secret, value) { return fspHex_(Utilities.computeHmacSha256Signature(value, secret, Utilities.Charset.UTF_8)); }
function fspEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var difference = 0;
  for (var i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function fspKeys_(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.slice().sort().join(','); }
function fspJson_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function fspReply_(secret, request, status, code, receipt) {
  var body = {nonce: request.nonce, payloadHash: fspHash_(request.payload), status: status, code: code, receipt: receipt || null};
  body.signature = fspHmac_(secret, JSON.stringify(['fsp-mail-response-v1', body.nonce, body.payloadHash, body.status, body.code, body.receipt]));
  return fspJson_(body);
}
function doGet() { return fspJson_({error: 'REJECTED'}); }
function doPost(event) {
  // Never log event, exceptions, recipient, token, signature, or Script Properties.
  var request, secret, lock;
  try {
    var contents = event && event.postData && event.postData.contents;
    if (typeof contents !== 'string' || contents.length > 8192) return doGet();
    request = JSON.parse(contents);
    if (!fspKeys_(request, ['timestamp', 'nonce', 'payload', 'signature']) ||
        !Number.isSafeInteger(request.timestamp) || typeof request.payload !== 'string' || request.payload.length > 4096 ||
        typeof request.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(request.nonce) || typeof request.signature !== 'string' || !/^[a-f0-9]{64}$/.test(request.signature)) return doGet();
    var properties = PropertiesService.getScriptProperties();
    secret = properties.getProperty('FSP_RELAY_HMAC_SECRET');
    if (!/^[a-f0-9]{64}$/i.test(secret || '') || !fspEqual_(request.signature, fspHmac_(secret, JSON.stringify(['fsp-mail-request-v1', request.timestamp, request.nonce, request.payload])))) return doGet();
    if (Math.abs(Date.now() - request.timestamp) > FSP_MAX_SKEW_MS) return fspReply_(secret, request, 'not_sent', 'EXPIRED');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return fspReply_(secret, request, 'not_sent', 'BUSY');
    // Re-read under the lock so parallel invocations share one durable budget.
    var all = properties.getProperties(), now = Date.now();
    if (all.FSP_RELAY_ENABLED !== 'true') return fspReply_(secret, request, 'not_sent', 'DISABLED');
    if (Math.abs(now - request.timestamp) > FSP_MAX_SKEW_MS) return fspReply_(secret, request, 'not_sent', 'EXPIRED');
    var payload = JSON.parse(request.payload), uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    var origin = all.FSP_RELAY_SITE_ORIGIN || '', audience = all.FSP_RELAY_AUDIENCE || '';
    var recipients = JSON.parse(all.FSP_RELAY_ALLOWED_RECIPIENTS || '[]');
    var limit = all.FSP_RELAY_ROLLING_24H_LIMIT === undefined ? 20 : Number(all.FSP_RELAY_ROLLING_24H_LIMIT);
    var address = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/;
    if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/.test(origin) || !/^[a-z0-9-]{1,64}$/.test(audience) ||
        !Array.isArray(recipients) || recipients.length < 1 || recipients.length > 10 || new Set(recipients).size !== recipients.length ||
        recipients.some(function (value) { return typeof value !== 'string' || value.length > 254 || !address.test(value); }) ||
        !Number.isInteger(limit) || limit < 1 || limit > 50) return fspReply_(secret, request, 'not_sent', 'DISABLED');
    if (!fspKeys_(payload, ['version', 'template', 'audience', 'idempotencyKey', 'challengeId', 'recipient', 'token', 'expiresAt', 'origin']) ||
        payload.version !== 1 || payload.template !== 'fsp-email-verification-v1' || payload.audience !== audience || payload.origin !== origin ||
        typeof payload.challengeId !== 'string' || !uuid.test(payload.challengeId) || payload.idempotencyKey !== 'fsp-verify-' + payload.challengeId ||
        typeof payload.recipient !== 'string' || !address.test(payload.recipient) || typeof payload.token !== 'string' || !/^[a-f0-9]{64}$/.test(payload.token) ||
        !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt > now + 15 * 60000) return fspReply_(secret, request, 'not_sent', 'INVALID_PAYLOAD');
    if (payload.expiresAt <= now) return fspReply_(secret, request, 'not_sent', 'EXPIRED');
    if (recipients.indexOf(payload.recipient) === -1) return fspReply_(secret, request, 'not_sent', 'NOT_ALLOWED');
    var nonceKey = 'nonce:' + request.nonce, nonceCount = 0;
    Object.keys(all).forEach(function (key) {
      if (key.indexOf('nonce:') !== 0) return;
      var expiry = Number(all[key]);
      if (!Number.isSafeInteger(expiry)) throw new Error('invalid ledger');
      if (expiry < now) properties.deleteProperty(key);
      else nonceCount++;
    });
    if (all[nonceKey] && Number(all[nonceKey]) >= now) return fspReply_(secret, request, 'not_sent', 'REPLAY');
    if (nonceCount >= FSP_MAX_NONCES) return fspReply_(secret, request, 'not_sent', 'STORAGE_FULL');
    // Future timestamps remain replayable for longer; retain until their window closes.
    properties.setProperty(nonceKey, String(request.timestamp + FSP_MAX_SKEW_MS));
    var receiptKey = 'receipt:' + fspHash_(payload.idempotencyKey), hash = fspHash_(request.payload);
    if (all[receiptKey]) {
      var previous = JSON.parse(all[receiptKey]);
      if (!Number.isSafeInteger(previous.at) || !/^[a-f0-9]{64}$/.test(previous.hash || '') || ['sent', 'unknown'].indexOf(previous.state) < 0) throw new Error('invalid ledger');
      if (previous.hash !== hash) return fspReply_(secret, request, 'not_sent', 'KEY_CONFLICT');
      if (previous.state === 'sent') return fspReply_(secret, request, 'sent', 'ACCEPTED', 'google-mailapp:' + payload.challengeId);
      return fspReply_(secret, request, 'unknown', 'DELIVERY_UNKNOWN');
    }
    var receipts = Object.keys(all).filter(function (key) { return key.indexOf('receipt:') === 0; });
    if (receipts.length >= FSP_MAX_RECEIPTS) return fspReply_(secret, request, 'not_sent', 'STORAGE_FULL');
    // Count durable reservations, including unknown outcomes. No midnight reset,
    // separate increment race, cache TTL, or evictable idempotency entry.
    var recent = 0;
    receipts.forEach(function (key) {
      var item = JSON.parse(all[key]);
      if (!Number.isSafeInteger(item.at) || !/^[a-f0-9]{64}$/.test(item.hash || '') || ['sent', 'unknown'].indexOf(item.state) < 0) throw new Error('invalid ledger');
      if (item.at > now - FSP_WINDOW_MS) recent++;
    });
    if (recent >= limit) return fspReply_(secret, request, 'not_sent', 'RATE_LIMIT');
    var quota = MailApp.getRemainingDailyQuota();
    if (!Number.isFinite(quota) || quota < 1) return fspReply_(secret, request, 'not_sent', 'QUOTA');
    // The reservation MUST be durable before entering MailApp. A crash between
    // send and receipt completion leaves UNKNOWN forever, never a resend.
    properties.setProperty(receiptKey, JSON.stringify({hash: hash, state: 'unknown', at: now}));
    var link = origin + '/account/verify#challenge=' + payload.challengeId + '&token=' + payload.token;
    MailApp.sendEmail({to: payload.recipient, subject: 'Подтверждение email · ФСП / ТАЛАНТЫ', body: 'Вы запросили подтверждение адреса для своего аккаунта. Откройте ссылку: ' + link + '\nСсылка действует 15 минут и используется один раз. Если запрос не ваш, проигнорируйте письмо.'});
    properties.setProperty(receiptKey, JSON.stringify({hash: hash, state: 'sent', at: now}));
    return fspReply_(secret, request, 'sent', 'ACCEPTED', 'google-mailapp:' + payload.challengeId);
  } catch (error) {
    // Conservatively includes storage failures and MailApp exceptions: neither
    // exception wording nor quota errors prove that no message was sent.
    if (secret && request && typeof request.payload === 'string') {
      try { return fspReply_(secret, request, 'unknown', 'DELIVERY_UNKNOWN'); } catch (ignored) { /* fail closed */ }
    }
    return doGet();
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}
