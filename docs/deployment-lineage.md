# Source and database lineages

## DEPLOYMENT BLOCKED for the existing v12 database

This branch reconciles code for review. It does not deploy the site or make the current site's database safe for an automatic upgrade. Use a fresh local database for the documented demo.

The public demo is Sites v12, source commit `95abaf6ec8e0eb49b62a7efa03f0050abfdb8550`, published 2026-10-10 04:33:14 UTC. The code-review base is repository main `1b30a28a8bf6dc1867a6fd21bfae74472cef7394`. They are different lineages.

- Mainline has `0004_email_payload_fingerprint` (1791439329186) and `0005_email_transport` (1791537884521).
- Deployed v12 has `0004_rainy_millenium_guard` (1791602601644), which creates `owner_email_tests` but not the two mainline outbox columns.
- This review branch adds `0006_mature_lady_mastermind` after mainline 0005. It creates the owner table and preserves mainline's outbox additions.

A timestamp-based migration ledger on deployed v12 can skip mainline 0004/0005 as older, then fail at 0006 because the owner table already exists. A filename-based replay can also collide with the existing table. Neither a successful fresh install nor the new 0006 migration proves that an existing v12 deployment is upgradeable.

Before any separately authorized deployment, inspect the actual database schema and migration ledger, back up state, design a ledger-specific forward reconciliation, and test it on a populated copy. Preserve owner-diagnostic receipts and outbox delivery/ambiguity state; never delete migration history or reset tables to force installation. No such production work was performed by this change.

`tests/migration-lineage.test.mjs` verifies a populated mainline upgrade preserves existing rows and both outbox columns. It also constructs the v12 schema lineage and proves the blind-replay collision and timestamp ordering. The latter is a negative safety test, not a tested upgrade procedure.
