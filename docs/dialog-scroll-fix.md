# Zoomed dialog scroll regression

2026-10-10. Base: `b64cdbc20e38e6b034ed939b2ce4a8c39f4e8a75` (public v11). Local patch; no deployment or business-logic change.

## Evidence and cause

Public-browser QA reproduced recruiter → Backend example → Olga → offer at actual Chrome 200% and 300% zoom. At 200%, viewport height was 378 CSS px and submit occupied y=426–462. At 300%, viewport height was 252 CSS px and submit occupied y=396–432. Tab focused the submit button without bringing it into view; wheel scrolling over the modal did not change its position. The centered dialog clipped top and bottom.

Source confirms the shared Radix DialogContent was fixed at top/left 50%, translated -50%, with no maximum height or overflow scrolling. Radix locks background scrolling, leaving an oversized dialog unreachable.

## Minimal fix

All elements with `data-slot="dialog-content"` now use:

- `max-height: calc(100vh - 2rem)`, followed by `calc(100dvh - 2rem)` for dynamic viewport support.
- `overflow-y: auto` to scroll the dialog, independent of the locked page.
- Vertical overscroll containment.
- One rem of scroll padding and half-rem focus-target scroll margin so focus outlines have clearance.

Existing Radix focus trap, Escape dismissal and focus restoration are unchanged. Offer, registration and reset share the same rule. There are no new dependencies, API changes or external actions.

## Checks

- Full test suite: 223 passed, zero failures/skips.
- Typecheck, lint and production build: passed.
- Static regression test checks the actual shared CSS selector, viewport fallback ordering, overflow and focus-clearance rules. This is not a browser layout test.
- `scripts/verify-dialog-scroll-browser.mjs` is supplied for supported-browser execution with `FSP_TEST_URL`. It tests short viewports 590×378 and 388×252, mobile 390×844 and desktop 1440×900; tabs through the dialog, checks the focused target remains within its bounds, verifies submit is reached, and checks Escape returns focus. It never submits an offer. Short viewports are proxies, not actual browser zoom.
- Local browser execution remains unavailable: the already verified installed Chromium fails before page load with a denied socket operation. No local browser pass is claimed and no workaround of the restriction was attempted.

## Required post-deployment acceptance

Repeat the original actual Chrome 200% and 300% zoom route. Confirm the dialog stays inside the viewport; wheel scroll moves its content; Tab/Shift+Tab scroll each focused control into view, including submit and close; Escape restores focus to Olga's offer button. Reopen, verify form controls remain usable, and cancel without sending. Also open New Profile and Reset; verify their last buttons can be focused and seen. Return zoom to 100% and confirm normal centered layout. Capture screenshots of visible focused submit at both zoom levels.
