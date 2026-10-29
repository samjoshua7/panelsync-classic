# PanelSync R2 staging migration

This is an **isolated migration**, not an in-place change to the running application. The original root `index.html`, `admin.html`, `display.html`, source Firebase data, source objects, billing and rules are not changed by building or copying to staging.

R2 has usage-based billing with a free allowance, not an unlimited/no-payment plan. Use **Standard** storage. Keep Workers on its Free plan unless separately approved. Durable Objects uses the SQLite backend available on Workers Free. Those services have their own limits; the 1 GB application storage cap does not cap request billing, other buckets or other Cloudflare services.

## User setup required

1. Cloudflare dashboard → Storage & databases → R2 → enable subscription after reviewing billing terms → create a **new empty Standard bucket** named `panelsync-media-staging`. Do not upload files outside the migration API: doing so bypasses the application quota ledger.
2. Create a **new Firebase Spark project**, with no linked billing account. Do not edit the old project. Register a web app, enable Google sign-in, and create Realtime Database in locked mode. Do not enable Firebase Storage in this project.
3. Supply the new web-app config (public configuration, not a service-account key), new database URL, bucket name, and Cloudflare account ID. Store configuration privately in `config.local.json`; do not paste tokens, OAuth secrets or service-account keys into chat.
4. Add the staging site's real origin to Firebase Authentication's authorized domains and to `ALLOWED_ORIGINS` in the Worker configuration. The default local testing origin is `http://127.0.0.1:5501`. A separate port/origin avoids old browser caches and auth sessions.
5. Authenticate Wrangler with `npx wrangler login` when requested. Use `gcloud auth login` for the target Google account too, preserving the source account login; migration selects accounts explicitly rather than changing the global project.

Migration requires the Google account selected for target sign-in to be an active migrated app **Super User**, or the user must explicitly choose its email as `bootstrapAdminEmail`. The account also needs permission to administer the target cloud project. Project ownership and app Super User status are different. An explicitly configured bootstrap adds/enables that admin in the **destination only**; it never changes the source. Source inventory found the currently logged-in source project owner is not an active app Super User, so this choice cannot be skipped.

## Deployment and build (agent steps after setup)

- Install pinned dependencies/lockfile; run `npm test` and a Wrangler deployment dry run first.
- Fill `wrangler.jsonc` with the new project/database and allowed staging origins; leave source Firebase untouched. Deploy this new Worker only, with its dedicated R2 bucket and SQLite Durable Object quota namespace.
- Browser uploads use a verified Firebase ID token. Worker checks actual active department/global roles in the **new** RTDB. No R2 secret appears in browser code.
- `node build.mjs config.local.json` creates a new ignored `.migration-private/staging-site-*` directory. Existing build directories are never overwritten. Source HTML remains unchanged. The build refuses the old Firebase project and unresolved placeholders.
- Run the source snapshot, dry-run plan, copy and hash verification below. No application should edit staging metadata during copy.
- Serve/deploy only the generated staging site at a separate URL. Never replace the live site at this stage.

## Data-copy tools

Run from `r2-migration/`:

```powershell
node migrate.mjs export SOURCE_ACCOUNT_EMAIL
node migrate.mjs plan config.local.json PATH_TO_PRIVATE_SOURCE_SNAPSHOT
node migrate.mjs copy config.local.json PATH_TO_PRIVATE_SOURCE_SNAPSHOT --apply
```

The config for copying additionally needs `sourceAccount`, `targetAccount`, and optionally `authRequestUri` matching an authorized target sign-in origin.

Export reads only the source RTDB's `users`, `depts`, `dept` and rules into an ignored private snapshot. Snapshot integrity is checked before copy. The 191-byte legacy `firebase_db.json` is not used. Freeze uploads/metadata edits briefly during snapshot capture; TVs can continue playing.

Copy seeds **only** new-project access/dept records first, signs into new-project Firebase Auth using the selected Google account, and installs generated **destination-only** role-aware rules. It downloads only referenced PanelSync assets from the known source bucket. It does not touch `complaints/`, Firestore, source authentication accounts, IAM, source rules or billing. Source downloads can consume source egress once.

Every R2 upload goes through the quota API. File sizes are checked; full SHA-256 content is compared against R2 before publishing any media URLs to the destination database. The new playlist is published only after all media pass. An existing non-bootstrap destination database is never overwritten. The source remains a rollback path.

On interruption: the source is unaffected. Re-run with the same snapshot; previously copied objects are hash-checked before reuse. A conservative reservation may remain after an ambiguous upload failure; do not manually reset the ledger or upload to the bucket. Investigate actual objects first. Completed migrations are not blindly re-imported over later edits.

## Storage-cap behavior

- Default cap is **1,000,000,000 bytes across all departments**, including active/archived slides, backgrounds, music, and reserved in-progress uploads. Maximum individual upload is 80 MiB.
- A Durable Object transaction reserves capacity before streaming, preventing concurrent uploads from exceeding the cap. Actual bytes are measured; existing immutable paths cannot be overwritten.
- Usage is shown in the generated admin. Stored bytes and upload reservations are separate; this is application usage, **not a Cloudflare invoice or account-wide storage meter**.
- Failed/ambiguous operations fail closed: retained reservations can reduce availability until verified reconciliation. No automatic expiry frees capacity while an upload might still exist.
- Deleted media releases capacity only after R2 deletion succeeds. The staging admin does not silently discard the media record if the delete API fails.
- Declared MIME type is restricted, but this is not malware scanning or video transcoding. Test actual content/codec playback on TVs.

## Delivery and acceptance

The staging Worker provides `/media/...` with CORS for allowed origins, immutable caching, HEAD, byte-range GET, 304 and 416 responses. Public media is publicly accessible; CORS is not anti-abuse authorization. Worker Free daily request limits apply, so this staging endpoint is not unlimited delivery. A dedicated production R2 custom-domain/cache strategy remains a production acceptance decision; `r2.dev` is not used as the production solution.

Before cutover, verify real Google sign-in, role isolation, upload/progress/delete, PDF conversion, archive/enable, all playlist fields, checksum counts, full videos, background/music, quota races and actual-TV first load/second loop/reload/offline behavior. The built-in unit tests use mocks and do not establish production correctness.

Only after explicit user approval should any TV URL or live deployment change. Rollback means returning TVs to the untouched original site. Keep old media until all devices pass; migrating PanelSync does not retire other Civic Voice services or stop their charges.
