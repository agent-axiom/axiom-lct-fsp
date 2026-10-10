# Judge demonstration: focused UX patch

2026-10-10. Base commit: `1b064e19dfe8b210ccf8a423757e86168b13c306`. Local patch only; no deployment, email sends, access changes, external accounts or provider configuration.

## Changes

- The two-role guide is expanded on first render, with a short route through search, offer, acceptance and employer contact. The existing self-solved assessment remains a separate optional demonstration; no answers are prefilled and no passing result is manufactured.
- Three quick examples submit actual existing search actions: Backend/Middle with Python and SQL, Frontend/Middle, and Backend with an unconfirmed Kubernetes requirement. They set all filters explicitly, so old filter values cannot silently constrain the example. The matcher and assessment bank are unchanged.
- Candidate-card scores are labeled “Соответствие”. Seed profiles state that their scores are fixture data and they did not take a test; measured evidence still comes from the existing evidence component.
- Switching profiles or creating a new demo profile with non-empty assessment answers now requires a browser confirmation. Cancel returns before the action or draft cleanup; the role, answers and tab are unchanged. Proceed preserves the existing policy: the server attempt remains active but local answers are cleared. Ordinary search, profile save and test submission do not prompt.
- Selected demo role IDs survive same-tab refresh and Back/Forward revalidation. Storage contains only a server-derived workspace partition and two synthetic role IDs. The partition includes API mode. It is not authorization; the switch action still enforces the existing server boundary. Account mode neither reads nor writes this feature. Reset and supported logout clear it. Malformed or unavailable storage does not block use; continuity after refresh is best-effort when browser storage is unavailable.

## Verified on final patch

- `npm test`: 222 passed, zero failures/skips, including six new navigation/preset/confirmation tests and the actual React SSR proof/expanded-guide check.
- `npm run typecheck`: passed.
- `npm run lint`: passed, zero errors/warnings.
- `npm run build`: passed, all Vinext build stages.
- `npm run evaluate`: passed; no matcher changes. This is the existing synthetic developer benchmark, not real hiring validation.
- `node scripts/verify-two-role.mjs`: 24 checks passed, zero external transport calls. Email confirmation in this test is a controlled fixture.
- `git diff --check`: passed.

## Browser status and acceptance script

NOT EXECUTED through a page. Bundled Playwright browser was absent; installed `/usr/bin/chromium` was then tried and exited before page load with `process_singleton_posix.cc:297 socket() failed: Operation not permitted`. No browser/mobile/screenshot pass is claimed. No restricted launch workaround was attempted.

On a supported browser executor with an authorized synthetic guest test URL:

```sh
FSP_TEST_URL=https://YOUR-AUTHORIZED-DEMO-URL node scripts/verify-judge-demo-browser.mjs
```

Set `CHROMIUM_PATH` only if the executor uses an installed supported Chromium. The script creates a fresh isolated context, requires no sign-in, does not send email and does not solve the test. It checks visible guide, all three examples, synthetic labeling, locked contacts, Escape/focus restoration, repeated offer submission, refresh to the selected non-default candidate, acceptance/contact, own PDF response, Back navigation, 390px overflow and both reset cancellation and confirmed guest reset. The script is provided for execution, not proof of a browser pass.

## Short human presentation route

1. Open the public guest demo. State that all people/results are synthetic and each visitor has an isolated workspace.
2. Choose “Открыть подбор”, then “Backend · Python / SQL”. Explain visible requirements, score formula and the seed-data evidence limitation.
3. Choose “Проверить пробел: Kubernetes”. Show the missing requirement instead of claiming the system measured it.
4. Choose “Frontend · Middle”, open the evidence disclosure for Мария, and send a synthetic salary offer. The contact stays locked.
5. Refresh to demonstrate continuity. Choose “Открыть приглашения кандидата”, accept, then return to employer → invitations. Show that consent opens the contact only for this offer's employer.
6. Optionally show the candidate's PDF, then the separate assessment without implying seed scores came from that assessment. A full test requires honest manual answers.
7. Reset only this synthetic guest if repeating the show. Do not claim independent users, general live email, FSP registry integration, validated professional grades or real hiring quality.

Before recording the full assessment, also enter one answer, attempt a role switch, cancel the browser confirmation and verify the same answer/role remains. Then approve the switch and confirm the disclosed draft-clear behavior. This browser check remains pending here.
