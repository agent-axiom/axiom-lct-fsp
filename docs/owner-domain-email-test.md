# One owner-only custom-domain diagnostic

This is a separately authorized, one-message check of `noreply@notify.kosarevsky.dev` through Resend. It does not retry or replace the earlier `onboarding@resend.dev` check. It does not activate real accounts, the normal outbox, invitations, verification links, or general email.

## Fixed scope

- Page: `/owner/domain-email-test`; API: `/api/owner/domain-email-test`.
- Only the platform-authenticated identity whose email matches the existing server-side `FSP_OWNER_EMAIL_TEST_TO` can read or initiate the check. The private recipient is never hardcoded in source or returned to the browser.
- Sender, benign subject/text, provider endpoint and operation ID are fixed in server source. The request accepts only `{"action":"send-owner-domain-test"}`. It cannot choose a sender, recipient, body, identity, event ID or transport.
- The existing `FSP_OWNER_EMAIL_TEST_ENABLED=true`, runtime-only `RESEND_API_KEY` and HTTPS `FSP_SITE_ORIGIN` are required. Publication never changes these settings. Keep `FSP_REAL_ACCOUNTS_ENABLED=false` and `FSP_EMAIL_MODE=off`.
- GET, page load and refresh only read status. Only the explicit send action performs a POST. Concurrent/repeated clicks cannot make another provider call.

## Durable receipt and no retry

The immutable event is `fsp-owner-resend-domain-sender-2026-10-10-v1`. It claims a separate row in the existing `owner_email_tests` table before contacting Resend and supplies that same provider idempotency key. No schema migration is needed. The original event `fsp-owner-resend-smoke-2026-10-10-v1` and all of its fields remain unchanged, including when its status is uncertain.

A claim is never released, reset or aged out. A rejection, timeout, invalid response, unexpected redirect, process crash or database failure after provider acceptance does not authorize another attempt. Waited-out `sending` is displayed as `unknown`, without sending again. Do not delete either receipt, change either ID or call the old endpoint to retry the domain operation. Only refresh status and inspect the provider/inbox through separately authorized access.

Network calls go only to `https://api.resend.com/emails`, with manual redirects, a 10-second deadline and a 16 KiB response limit. Responses and receipt fields contain only sanitized statuses/codes, hashes and a validated provider ID. Credentials, recipient addresses, message text and raw provider errors are not logged or returned by this diagnostic. `accepted` means Resend accepted the request; it does not prove inbox delivery.

## Verification and deployment boundary

`node --test tests/owner-domain-email-test.test.mjs tests/owner-email-test.test.mjs` uses synthetic identities/addresses, an in-memory SQLite/D1 adapter and mocked transport. It covers unauthorized/forged input, missing configuration, concurrency, provider ambiguity, timeouts, redaction, oversized provider bodies, both event IDs, exact preservation of prior receipts and unchanged general account/outbox data. No real email is sent by these tests.

Run the full canonical suite before release. For the existing Site, select the tracked `sites-v12` profile using `scripts/prepare-sites-v12.mjs` from a clean committed checkout, then follow its build/verification instructions. Neither implementation nor local tests confirm DNS verification, Resend permission, live identity authorization or inbox delivery. Publication and the single live POST are separate operations.
