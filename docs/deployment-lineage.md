# Application source and database migration profiles

## Current source

GitHub main `cc5549085f3cfb2ea58533fbd56a2e9be73d6724` contains the reconciled application reviewed in PR #7. Its full local suite and GitHub CI passed. The live Site remains v12, source `95abaf6ec8e0eb49b62a7efa03f0050abfdb8550`; the application has not yet been synchronized through the profile described here.

There are two legitimate database histories leading to the same application schema. They must remain distinct and immutable. Shared application code does not require rewriting an already applied migration.

## Default path: clean mainline local installation

The normal checkout uses `./drizzle/`: migrations 0000–0003, `0004_email_payload_fingerprint`, `0005_email_transport`, and `0006_mature_lady_mastermind` (owner diagnostic table). This remains the default. Build with `npm run build`, run `node scripts/migrate-local.mjs`, and then `node scripts/local-demo.mjs`. Local state is `./.wrangler/state`; HTTP is http://localhost:8888. Use a fresh state directory for this route, not an existing v12 database.

The mainline files and journal are unchanged by the profile proposal. Mainline migration regression tests continue to use this default path.

## DEPLOYMENT BLOCKED: blind use of the default chain on v12

Deployed v12 instead has `0004_rainy_millenium_guard` at timestamp 1791602601644. It already created `owner_email_tests`, but did not add outbox columns `payload_hash` or `email_transport`.

Mainline 0004 (1791439329186) and 0005 (1791537884521) are older than v12's latest migration. A timestamp-based replay can therefore skip those required columns, then collide with the existing owner table at mainline 0006. The negative lineage regression reproduces both conditions. Do not publish the default mainline migration folder over the existing Site database.

## Supported preparation path: explicit Sites v12 profile

The tracked [Sites v12 profile](../migration-profiles/sites-v12/README.md) preserves deployed v12 SQL, snapshots and its five journal entries byte-for-byte. It appends only `0005_align_mainline_email_columns`, timestamp 1791660557251:

- `email_transport TEXT DEFAULT 'resend' NOT NULL`
- nullable `payload_hash TEXT`

The new SQL is schema-only and non-destructive. It neither recreates tables nor rewrites rows, receipts or the migration ledger. The resulting schema matches clean mainline, including columns, defaults and indexes.

From a clean committed checkout, first run the normal checks and `node scripts/verify-sites-v12-profile.mjs`. Then select the profile using `node scripts/prepare-sites-v12.mjs --output /absolute/empty/fsp-site-stage`. The script never edits the original checkout, copies only tracked files, replaces `drizzle/` only inside the staging directory, and emits `SOURCE-PROVENANCE.json` with source commit and file hashes. It does not push or publish.

Run the staged build and fresh-profile local migration/HTTP smoke checks. Keep the full mainline regression suite in the canonical checkout: some tests intentionally reference mainline SQL filenames. Integrate the selected source into the existing Site through the supported source/package workflow, preserving Site identity and access. Record both GitHub application-source and Sites deployment-source SHAs; the migration profile and provenance file explain their difference.

## Verification

The actual installed Drizzle D1 migrator was exercised locally with an in-memory SQLite adapter:

- original v12 history remained immutable;
- a populated v12 fixture upgraded with every pre-existing field and row preserved, including the owner receipt;
- legacy outbox rows received transport=`resend`, payload_hash=`null`;
- rerunning the migration did nothing;
- fresh profile schema matched fresh mainline schema.

The selected-profile build, clean local migrations and HTTP smoke passed (home 200, private API without identity 401, guest API 200, real email OFF). Separately, all 223 original v12 tests passed unchanged against the upgraded schema. This supports old-application compatibility; it is not a fresh browser E2E or a production restore test.

## Live evidence and recovery limitations

On 10 October 2026, supported read tools showed v12 as the latest saved/live source with no later saved version. Its visible schema matched the v12 chain; both proposed outbox columns were absent, outbox had zero rows and the owner-diagnostic table retained one receipt. These mutually consistent observations provide evidence for the bounded append-only path. The internal ledger is not exposed by the tools; direct access to it is not a blanket prerequisite when provenance and observed schema agree.

The available row viewer is not a complete backup/export route: guest/workspace state values were truncated, and reads are not an atomic database snapshot. The intact owner receipt was restored and compared locally, but no production restore facility was demonstrated. This is a disclosed recovery limitation, not a claim of a full backup or an invented prohibition on additive changes.

Old v12 application code tolerates the two extra columns. Reverting to the previously saved Worker does not remove them, so no destructive schema rollback is proposed. A failed publication may already have applied migrations: inspect native deployment status and visible schema before retrying, retain the same applied migration bytes, and never clear tables or receipts to force recovery. Runtime real-account/email switches remain unchanged by source preparation or migration.
