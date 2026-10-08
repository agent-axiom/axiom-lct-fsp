# Assessment interruption, contact status and dialog focus patch

Date: 2026-10-07. Baseline: integrated tree `861bd44390b2607febb91864c5b1162cf5e3c450` (GitHub commit `d840efd71b76c2716e2a4186cc0dc0f5f99d7b39`). No deployment or live personal-data actions.

## Behavior and privacy

- Candidate-entered answers are saved synchronously on each change in a single `sessionStorage` slot. They survive refresh and same-tab navigation interruptions when browser storage is available. They are not uploaded as drafts, written to localStorage, or promised to survive closing the tab/browser.
- Restoration waits for a successful authoritative state response. The binding must match API mode, opaque identity partition, candidate ID, active random attempt ID, effective deadline, specialization, grade and the public question contract. Identical demo-candidate IDs in different owners/guest sessions cannot collide. Employer/unverified state cannot restore a draft. The tab's sessionStorage is the browser-session boundary; this is not a new platform-authentication/session system.
- The opaque partition is SHA-256 of the versioned namespace, mode, and trusted server input: platform owner ID for private demos; issuer/subject for role-bound accounts; the already-resolved guest token hash for guests. Only the 64-character derived value is returned. No email, contact, raw platform identity, guest cookie, or guest DB lookup hash is returned by this field. It is not a credential and no authorization path accepts it. Copying it into an account header or guest cookie fails authorization in regression tests. This is pseudonymous partitioning, not a claim of anonymity or encryption; known low-entropy inputs could be tested against an unsalted hash.
- Storage contains only a version, an explicit public-field binding and candidate-entered answers. Complete test/question objects, answer keys, alternatives, grading outcomes and account/contact fields are never serialized. No assessment bank, scoring, category, matching or history rules changed.
- Successful submission acknowledgement removes the draft before the state refresh, even if that refresh fails. Successful profile switching/new-profile registration/reset and supported logout links also clear it. Test or guest expiry clears it via a timer and blocks further editing/submission; a subsequent authoritative read without the active attempt also purges it. Unauthorized state/action responses clear it. Back/Forward cache restoration hides stale workspace data until revalidation; an identity/actor change also clears old displayed search results and offer state.
- Malformed/oversized/stale records, unknown questions, invalid choices and non-string answers are discarded. Answers are capped at 500 characters in the short-answer UI. Quota or storage-security errors keep current answers in memory, show a warning and attempt to remove any stale persisted copy; if removal alone fails, an empty tombstone is attempted. Browser storage that denies all access cannot guarantee cleanup; restoration still requires the exact server-authorized binding. Ordinary fetch/submit failure does not discard usable answers.

## Other two fixes

- Accepted invitation with no authorized `candidateContact`: “Контакт недоступен: нет действующего согласия кандидата.” Pending and declined invitations have distinct labels. The UI uses the existing authorized DTO and neither asks for nor exposes protected fields.
- Offer button captures its actual `event.currentTarget`. Radix `onCloseAutoFocus` restores focus after Escape/close/submission to that connected, visible, enabled trigger. If unavailable, it tries the search button, then the focusable page heading. The modal focus trap and business actions are unchanged.

## Verification

- `npm test`: 195/195 passing; zero failures, skips or cancellations. Includes 14 added regression cases for draft isolation/lifecycle/storage failures, authoritative identity derivation/non-authorization, consent wording and focus fallback.
- `npm run typecheck`: pass.
- `npm run lint`: pass, zero errors/warnings on the final source.
- `npm run build`: pass, all five Vinext stages and six route entries.
- `node scripts/evaluate-assessment-quality.mjs`: pass; 144/144 references, 21,600 variant answers, 24,576 threshold patterns, zero key disagreements/threshold mismatches. Generated timestamp-only fixture output was reverted.
- `node scripts/evaluate-matching.mjs`: pass; synthetic regression P@5 0.95, NDCG@5 1.0, unchanged implementation.
- `node scripts/verify-two-role.mjs`: 24 checks passed, zero external transport calls.
- `git diff --check`: pass.
- Local Chromium was attempted once and blocked before any page load: `process_singleton_posix.cc:297`, `socket() failed: Operation not permitted (1)`, process exited SIGABRT. No launch-flag workaround or browser pass is claimed. Source/logic tests are not a substitute for the pending supported browser regression.

## Supported-browser recheck after an authorized release

1. Enter both choice and free-text assessment answers; reload and navigate away/back in the same tab. Confirm answers, question order, attempt and deadline are unchanged.
2. Interrupt a submit with a network failure; retry. Confirm failure preserves answers and a successful submit removes the draft and creates only the normal attempt/history result.
3. Check logout, profile/role switch, reset, test expiry and guest-session expiry. Confirm draft removal and no restoration into another owner or role. With storage blocked, confirm a visible warning and usable form.
4. Accept an invitation, withdraw candidate consent, and open the employer's invitation view. Confirm no contact and the unavailable wording.
5. Open an offer by keyboard, press Escape and close via X; repeat. Confirm focus returns to that offer button. Remove/hide the original trigger while open and confirm safe fallback. Verify focus remains trapped while open.

## Existing framework warning (not changed)

The reported `[vinext] RSC prefetch setup error: TypeError: f is not a function` is logged by the installed Vinext Link/navigation shims. App usage consists of ordinary `next/link` links back to `/`, without a supplied prefetch callback. This makes framework prefetch setup a likely scope, not a confirmed root cause. No framework or dependency changes were made; navigation was reported functional by independent QA.
