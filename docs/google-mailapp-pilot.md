# Google MailApp pilot (OFF by default)

This is a new implementation, not a recovered historical relay. Publishing source or merging the PR does not create a Google project, authorize an account, deploy a relay, change runtime secrets, enable email, or send a message. Resend remains the default transport. Existing demo behavior is unchanged.

## Boundaries

- Only the fixed FSP email-verification template is supported. The server chooses the owning account, recipient and challenge. The relay refuses custom subject/body/from/CC/BCC, arbitrary origins, other audiences and additional payload fields.
- Initial live testing is restricted to the sender/owner's own address. Adding other recipients or real user data requires separate approval and the existing privacy/retention readiness review. Do not put personal addresses in public issues or deployment instructions.
- Relay allowlist: 1–10 exact lowercase addresses; no wildcard or domain-wide permission. Default cap: 20 reserved sends in a rolling 24 hours; configurable hard ceiling: 50. Unknown outcomes consume the budget. Google remaining quota is checked as a separate limit.
- The Apps Script manifest grants only `https://www.googleapis.com/auth/script.send_mail`. No inbox, Gmail API, Drive, Sheets or external-request scopes are requested. Script Properties store the configuration, nonce replay ledger and redacted durable receipts.
- The Google execution account is the sender. `FSP_EMAIL_FROM` and a Resend domain are not used by this transport. Owner execution and the visible sender must be verified during the separately approved live test.

## Delivery model: no exactly-once claim

MailApp returns no message ID or idempotency guarantee. A receipt from this relay means its `MailApp.sendEmail` call returned, not inbox delivery. `google-mailapp:<challenge UUID>` is a relay receipt, not a Google provider message ID.

Every send reserves a durable `unknown` receipt under a script-wide lock before entering MailApp. Only after a successful return is it marked `sent`. A crash, timeout or persistence failure after reservation may leave `unknown`; it is never automatically sent again. Duplicate idempotency keys return the existing receipt; altered payloads are refused. Receipts are never automatically evicted. The 1,000-receipt capacity fails closed and requires an explicit maintenance decision, not clearing the ledger to retry.

The application stores transport identity on each outbox job and fingerprints the Google deployment URL with its payload. Changing providers or deployment URLs cannot resend an existing job. Network loss, unsigned/malformed responses, unknown responses and expired Google worker leases become terminal `DELIVERY_UNKNOWN` (`failed` in SQL, `unknown` in the owner DTO). Status reads do not dispatch. Only authenticated pre-send `BUSY`, `QUOTA` and `RATE_LIMIT` responses permit the existing bounded, explicit same-attempt retry. Resend retains its existing idempotent retry behavior.

An unknown link cannot verify the account because its challenge is not marked sent. The owner can explicitly request a new challenge, subject to the existing per-account limits. This may create a second email if the first was delivered; the UI explains that the old attempt will not be repeated. Do not change a failed/unknown row back to queued, erase receipts, or switch the relay to a fresh project to repair an uncertain send.

## Protocol and storage

Requests are HTTPS POST JSON envelopes with millisecond timestamp, UUID nonce, exact payload string and HMAC-SHA256 signature. Request and response signatures use different domain prefixes. Timestamp tolerance is five minutes. Replay nonces persist until the timestamp window closes, including future-skewed timestamps; the nonce store also has a 1,000-entry fail-closed cap. The response signature binds the request nonce, payload hash, outcome and receipt. The app follows only a 302/303 GET to the exact Apps Script ContentService response host, with no payload or authorization forwarded. Other redirects and HTTP errors remain ambiguous.

Stored receipts contain only a SHA-256 payload fingerprint, state and reservation time, under a hash of the idempotency key. Recipients and confirmation tokens are not stored in the relay ledger or logged. The configured allowlist necessarily contains approved addresses. Editors of the Apps Script project can access its secret and sending authority: keep the project private and do not add editors without an access review. HMAC authenticates server possession of a secret; it does not protect against a compromised app server or project owner. Public endpoint invocation can consume Apps Script execution quota even when authentication fails.

## Configuration and separately approved activation

No secrets or grants are created by this repository. Use the owner's approved secure secret-entry workflow, never chat, Git, URLs, browser-visible app variables or logs. Keep `FSP_EMAIL_MODE=off` and `FSP_REAL_ACCOUNTS_ENABLED=false` during preparation.

1. The owner creates a private standalone Apps Script project and copies `integrations/google-mailapp/Code.gs` and `appsscript.json`. Creating/authorizing/deploying the real account integration requires separate approval. Review the single send-only scope before consenting.
2. Set Script Properties:
   - `FSP_RELAY_ENABLED=false` initially
   - `FSP_RELAY_HMAC_SECRET`: approved, securely generated 64-hex-character secret; separate from the email-token secret
   - `FSP_RELAY_AUDIENCE`: unique lowercase letters/digits/hyphens, 1–64 characters, for this FSP deployment
   - `FSP_RELAY_SITE_ORIGIN`: exact canonical HTTPS application origin, no trailing slash/path/query
   - `FSP_RELAY_ALLOWED_RECIPIENTS`: JSON array containing only the approved owner address for the first pilot
   - `FSP_RELAY_ROLLING_24H_LIMIT=20` (integer 1–50)
3. After approval, deploy as a versioned web app executing as the owner. A server-to-server call requires endpoint access without interactive Google sign-in; application-level HMAC remains mandatory. Do not use `/dev`. Check that no broader OAuth scopes were added.
4. In the server runtime only, set `FSP_EMAIL_TRANSPORT=google-mailapp`, `FSP_GOOGLE_RELAY_URL` to the verified `https://script.google.com/macros/s/<deployment ID>/exec` URL, `FSP_GOOGLE_RELAY_AUDIENCE` and `FSP_GOOGLE_RELAY_SECRET`. Preserve the distinct `FSP_EMAIL_TOKEN_SECRET` and exact `FSP_SITE_ORIGIN`. Apply additive migration `0005_email_transport.sql`; no historical data is deleted.
5. After explicit permission for the owner-only test and privacy readiness, enable the relay and application switches in the approved environment. Use the normal authenticated account request. Verify one received message, sender identity, the one-use/expiry behavior and account-owner binding. Check replay/unknown behavior using synthetic mocks first, never by deliberately duplicating real mail.
6. Rollback: set `FSP_EMAIL_MODE=off`, then `FSP_RELAY_ENABLED=false`. Preserve the ledger, migration and terminal jobs. Do not turn blocked jobs into queued jobs. Re-enabling does not reactivate blocked/failed rows.

## Verification and limits

`npm test` includes the actual `.gs` source executed in a Node VM with mocked Google services and SQLite-backed HTTP/outbox tests. It covers signed request/response tampering, replay, origin/audience/recipient isolation, fixed template, rolling budgets, quota, persistent receipt failures, worker crashes, deployment/provider pinning, timeout/late success, redirect handling and existing Resend behavior. No real mail is sent by tests. These checks do not establish actual Apps Script deployment compatibility, Google account consent, quota availability, sender identity or inbox delivery. A separately approved live owner-only acceptance test remains required.

Official sources checked 2026-10-09:
- [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app): send-only service, scope and return values.
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas): consumer email quota currently 100 recipients/day, subject to change; independent of this pilot's lower rolling cap.
- [Web apps](https://developers.google.com/apps-script/guides/web): deployment execution identity and POST entry point.
- [ContentService](https://developers.google.com/apps-script/guides/content): response redirect to `script.googleusercontent.com`.
