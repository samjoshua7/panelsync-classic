# B2 staging migration

## Local app switch (October 29)

The root app is now switched to the new backend, not just generated staging
copies. See the root README for current startup instructions. The statements
below about keeping root HTML unchanged describe the earlier migration phase.
The old cloud source and published site have NOT been changed or deleted.

Current repairs: live membership-based dashboard gate, global role-3-only
cross-department access, narrower directory reads, localhost port support in
Worker CORS, preview error feedback, and durable cleanup obligations for
deletions, replacement assets and uploads awaiting publication. Cleanup removes
actual B2 versions and Worker quota; jobs retry while an authorized dashboard
is open. Interrupted-upload reservations can be cleaned after the active upload
window expires. Shared references are protected. This is not a guarantee of
immediate deletion across independent/offline systems or of zero charges.

19 unit tests plus the existing cache/display suites passed. Live read-only
checks passed video HEAD/MIME/CORS on port 5502, local upload preflight, anonymous
directory denial, and new-project-only root HTML. UI automation approval timed
out, so the new dashboard's visual/authenticated end-to-end acceptance remains
pending; no LCP improvement or full live workflow pass is claimed.

## Current status

Staging Worker deployed at https://panelsync-b2-staging.fxodapp.workers.dev.
Staging data migration completed: 3 departments, 9 unique media files,
95,052,060 bytes. Every copied file passed full SHA-256 comparison against its
source before rewritten metadata was imported into `fx-panelsync`. No source
data, source rules, root application HTML, or production URLs were changed.

Live staging verification passed HEAD/content lengths/MIME/CORS/immutable
validators/304, MP4 byte ranges, private user-directory denial, anonymous API
denial and administrator quota access. Quota equals the 9 unique files, with
zero pending reservations. A separate unique tiny PNG was uploaded/read back
and actually version-deleted; its bytes were removed from quota accounting.
Only that test file was deleted, not any migrated/source media.

Eleven unit tests, the existing cache/display tests and a local real
workerd/SQLite integration test passed. The latter uses simulated B2 network;
the checks above were run against the real deployed B2 Worker.

The B2 download timeout now bounds waiting for response headers, not an entire
healthy video transfer; slow clients are not forcibly cut off at 45 seconds.

**Still required:** real browser/TV playback, persisted-cache reload/offline
acceptance, checking B2 usage reporting for the Cloudflare transfer path, and
explicit hosting/cutover approval. No claim of unlimited free service or
completed production cutover is made.

Local staging display: http://127.0.0.1:5501/display.html?dept=cse
Local staging admin entry: http://127.0.0.1:5501/
These require `serve-staging.mjs` running on this computer and are not public
hosting URLs or links that a different TV can reach via its own localhost.

Repeat read-only live checks with `node b2-migration/verify-staging.mjs`.
`smoke-storage.mjs` performs one tiny temporary test upload/deletion; it is not
a read-only check. Both require a current private migration Firebase session.

This is the selected migration target. `../r2-migration/` is an abandoned
R2 prototype, not a deployment target. Do not run its deploy or copy commands.

The JSON files here contain public configuration only. Never add a B2
application key, Firebase ID token, Google OAuth token, or Cloudflare API token.

## Isolation

- Source Firebase `civic-voice-530e3` and root application HTML remain unchanged.
- Destination Firebase is `fx-panelsync` (Spark).
- Media destination is private B2 bucket `panelsync-bucket`.
- Delivery/authentication will use Workers Free, not R2.
- A private bucket does not automatically make the eventual media delivery URL
  private. The implementation must explicitly document display access policy.
- Saving configuration does not change cloud data or Firebase rules. The new
  staging Worker, quota namespace, destination-only Firebase metadata/rules and
  the copied B2 media are deployed. The source remains unchanged.

The gcloud OAuth token was rejected by Firebase app sign-in with
`INVALID_IDP_RESPONSE`. A local-only sign-in helper now supplies a verified
Firebase ID token instead; no token should ever be pasted in chat. Run
`serve-staging.mjs BUILD_DIRECTORY`, open
http://127.0.0.1:5501/migration-login.html and sign in with the new administrator.
The credential-accepting route expires after 15 minutes. The saved session is
ignored under `.migration-private/` and is checked for signature, project,
verified email and expiry before migration uses it. Restart the helper and
sign in again if the session expires.

## Next setup step: Cloudflare CLI login

The existing, installed Wrangler CLI can be used to authenticate without
deploying the old prototype. From PowerShell:

```powershell
cd D:\Git\panelsync-classic
& .\r2-migration\node_modules\.bin\wrangler.cmd login
& .\r2-migration\node_modules\.bin\wrangler.cmd whoami
```

Authorize the Cloudflare account whose ID is recorded in staging.config.json.
Do not upgrade the plan, enable R2, or run `deploy` yet.

## Install credentials privately (user action)

Run from the repository root, one at a time:

```powershell
& .\r2-migration\node_modules\.bin\wrangler.cmd secret put B2_KEY_ID --config .\b2-migration\wrangler.jsonc
& .\r2-migration\node_modules\.bin\wrangler.cmd secret put B2_APPLICATION_KEY --config .\b2-migration\wrangler.jsonc
gcloud auth login fxodapp@gmail.com
```

The first prompt takes the restricted B2 keyID, the second its applicationKey.
The Google login must use the NEW project owner account. Do not change the
default gcloud project to the old project for destination writes; migration
scripts specify destination URLs and account names explicitly.
Never pass secret values as command-line arguments or paste them in chat.

## Build and tests

```powershell
node --test b2-migration/tests/*.test.mjs
node b2-migration/build.mjs b2-migration/config.local.json
```

Builds are isolated under ignored `.migration-private/`; they never replace
root application files. Keep `config.local.json` private/ignored.

`tests/runtime-worker.mjs` is a local-only fake backend. NEVER deploy it.
The deployed entrypoint must remain `worker.mjs` in `wrangler.jsonc`.
Migration can be planned with `migrate.mjs plan CONFIG SNAPSHOT`; the explicit
`copy ... --apply` operation is for the next verified stage, not a setup step.

## Required verification before switching any display

1. Worker has no R2 binding or paid-plan requirement.
2. Firebase Google login works for the designated administrator; bootstrap is
   destination-only and rules deny unauthorized writes and role escalation.
3. B2 uploads authenticate server-side; immutable paths and a conservative
   storage budget prevent repeated versions silently consuming storage.
4. Deletion removes actual stored versions, not only an S3 delete marker.
5. Media GET, HEAD, byte ranges, MIME types, CORS and validators work, and errors
   are not cached as successful files.
6. Browser reload reuses persisted full-file cache; preloading and playback do
   not independently download the same media. Verify with network evidence.
7. Upload and playback test on staging before migration; compare hashes for any
   copied media, then import rewritten metadata only into the new database.
8. Source stays available for rollback. No production URL switch or source
   deletion without explicit approval.

B2 account caps and Workers Free quotas can stop service. They are not a
promise of unlimited delivery. The account's screenshot showed a 10 GB storage
allowance, 1 GB daily download allowance and 2,500 Class B requests per day;
verify actual B2-to-Cloudflare transfer behavior in staging before relying on it.
