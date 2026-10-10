# Existing Sites v12 migration profile

This tracked profile keeps the mainline checkout's default migrations unchanged while making the existing Site's different migration history reproducible. Application code is shared. Only the deployment staging directory's `drizzle/` tree changes.

Baseline Site source: `95abaf6ec8e0eb49b62a7efa03f0050abfdb8550` (Sites v12).
Application base: GitHub main `cc5549085f3cfb2ea58533fbd56a2e9be73d6724`.

`manifest.json` pins the existing v12 migration SQL/snapshot bytes, journal entries, target Site identity and expected application schema. Common 0000–0003 files are reused from the default `drizzle/` directory. V12's original owner-table 0004 is preserved. Generated 0005 adds only `email_transport TEXT DEFAULT 'resend' NOT NULL` and nullable `payload_hash TEXT` to the outbox. It does not recreate tables, delete rows, clear a receipt or enable email.

## Reproduce

Start in a clean committed checkout with Node.js 24.19.0 and installed lockfile dependencies:

```sh
npm run install:ci
npm test
npm run typecheck
npm run lint
node scripts/verify-sites-v12-profile.mjs
node scripts/prepare-sites-v12.mjs --output /absolute/empty/fsp-site-stage
```

The selection command refuses dirty tracked files, a stale schema/profile, a different Site ID, symlinked output, and output inside the checkout. It copies only tracked files and writes `SOURCE-PROVENANCE.json` with the exact source commit and per-file hashes. No credential, runtime state or database export is copied. No Git push or deployment occurs.

Install dependencies in the stage without modifying its lockfile, build there, apply its selected migrations only to a fresh local database, and run the local HTTP smoke check. Keep the repository's normal full regression suite in the canonical checkout: some mainline-migration regression tests intentionally refer to mainline SQL filenames, so running the whole suite inside the deployment stage is not the profile validation route. `verify-sites-v12-profile.mjs` exercises the actual Drizzle D1 migrator against both lineages and a populated synthetic upgrade.

Use the existing Site's supported source/package workflow to integrate the stage, preserving the Site checkout's `.git` and `.openai/hosting.json`. Publication is a separate authorized operation. The deployed source SHA may differ from the GitHub source SHA because its migration history and provenance file differ; both must be recorded.

## Evidence and operational limits

Verified locally: immutable v12 prefix; populated upgrade preserves all existing rows and owner receipt; second run is a no-op; fresh-profile schema equals mainline schema. Live read-only evidence on 10 October showed the latest saved/published source still v12, no later version, missing outbox columns, zero outbox rows, and one owner receipt. This supports the append-only path. It is not a direct inspection of the internal migration ledger.

A bounded row-view export is not a complete database backup: live guest/workspace state values were truncated. An intact owner receipt was restored and compared locally; this does not establish production restore capability. Do not publish private row captures.

These are additive columns; old v12 application code can ignore them. Returning to the previous Worker does not remove the columns or reset migration history. No destructive schema rollback is proposed. A failed deployment may already have applied migrations, so re-read schema/status before retrying and preserve the generated migration unchanged.
