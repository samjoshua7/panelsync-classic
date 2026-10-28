# B2 staging migration

## Current status

Staging Worker deployed at https://panelsync-b2-staging.fxodapp.workers.dev.
Credentials are installed and a real B2 read preflight passed (404 for the
deliberately nonexistent path). Destination-only non-media bootstrap and
role-aware rules are installed. Anonymous users access is denied (401), public
display playlist reads succeed (200). No real B2 uploads tested yet; no media
copied, and no source data, source rules, or production URLs changed.
Eleven unit tests and a real local workerd /
SQLite integration test passed (B2 network simulated). Existing cache/display
tests also passed. Actual browser/TV and B2 acceptance tests remain required.

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
  staging Worker, quota namespace and destination-only Firebase bootstrap/rules
  are deployed so far.

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
