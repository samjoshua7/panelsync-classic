# PanelSync Classic

Multi-department digital signage with a browser-based administration workspace,
Google authentication, Firebase playlist metadata, a Cloudflare media gateway,
and private Backblaze B2 object storage.

This document describes the **current root application**, not the original
Firebase Storage deployment. It is a maintainer handoff and operations guide.
Implementation details are authoritative in the linked source files; provider
plans, quotas, account configuration and deployed versions must be checked
independently before production changes.

## Contents

- [Architecture](#architecture)
- [Repository map](#repository-map)
- [Runtime and dependencies](#runtime-and-dependencies)
- [Local development](#local-development)
- [Configuration and secrets](#configuration-and-secrets)
- [Authentication and authorization](#authentication-and-authorization)
- [Firebase data model](#firebase-data-model)
- [Media management lifecycle](#media-management-lifecycle)
- [Worker HTTP API](#worker-http-api)
- [B2 adapter and quota ledger](#b2-adapter-and-quota-ledger)
- [Display playback and caching](#display-playback-and-caching)
- [Dashboard and previews](#dashboard-and-previews)
- [Limits and failure behavior](#limits-and-failure-behavior)
- [Tests and acceptance](#tests-and-acceptance)
- [Deployment and rollback](#deployment-and-rollback)
- [Migration tools](#migration-tools)
- [Troubleshooting](#troubleshooting)
- [Security and maintenance backlog](#security-and-maintenance-backlog)

## Architecture

```text
Administration browser
  ├─ Google sign-in ───────────── Firebase Authentication
  ├─ identity/membership/data ─── Firebase Realtime Database
  └─ Firebase ID token + bytes ── Cloudflare Worker
                                    ├─ verifies JWT and current Firebase roles
                                    ├─ SQLite Durable Object: quota ledger
                                    └─ secret-authenticated native B2 API
                                         └─ private Backblaze bucket

Display browser / TV
  ├─ public Firebase REST reads: active playlist/settings/background/music
  ├─ media URL ── Worker ── B2 (when a network download is required)
  └─ IndexedDB + reference-counted blob URLs (local playback reuse)
```

| Component | Responsibility | Not its responsibility |
| --- | --- | --- |
| Static site host | Serves HTML, JavaScript and CSS | Does not hold B2 secrets or execute the Worker |
| Firebase Authentication | Google sign-in and Firebase identity tokens | Does not itself grant department membership |
| Firebase Realtime Database | Departments, users/roles, slide records, text, settings, media URLs, cleanup jobs | Does not store current media bytes |
| Cloudflare Worker | Authenticated uploads/deletions, public media delivery, CORS, byte ranges | Is not R2 or a complete frontend host |
| SQLite-backed Durable Object | Serializes storage reservations and records accounted objects | Does not track download spending or hold video bodies permanently |
| Backblaze B2 | Actual images, MP4 files, backgrounds and audio | Does not interpret Firebase roles |
| Display browser | Local persistent media cache and playback | Cannot guarantee persistence under eviction, private mode or storage failure |

**There is no R2 binding in the current Worker and no explicit Cloudflare edge
media-cache layer.** The gateway performs B2 metadata/download operations on
requests that reach it. Browser HTTP caching and IndexedDB reduce those requests;
do not equate a Worker with an automatically populated CDN cache.

The bucket is private, but `/media/...` delivery is deliberately public for
unauthenticated displays. Anyone who obtains a working media URL can request it
without a Firebase login. CORS is a browser policy, not content authorization or
protection against scripts, bots, hotlinking or download abuse.

### Current deployment identifiers

These are public routing identifiers, not credentials:

| Setting | Current value |
| --- | --- |
| Firebase project | `fx-panelsync` |
| Auth domain | `fx-panelsync.firebaseapp.com` |
| Realtime Database | `https://fx-panelsync-default-rtdb.firebaseio.com` |
| Worker script | `panelsync-b2-staging` — name retained from migration |
| Media API | `https://panelsync-b2-staging.fxodapp.workers.dev` |
| B2 bucket | `panelsync-bucket` |
| B2 region / S3 endpoint | `us-east-005` / `s3.us-east-005.backblazeb2.com` |

The adapter actually uses the **B2 native v4 API**, discovering native API and
download hosts through authorization; it does not use the S3 endpoint for normal
uploads or deletion. The old `civic-voice-530e3` project is migration history and
must not be reintroduced into root application configuration.

## Repository map

| Path | Purpose |
| --- | --- |
| [index.html](index.html) | Google login, normalized department hint, redirect to authorized dashboard |
| [admin.html](admin.html) | Content forms, slide grid, ordering, enable/disable, text editing, users, modals and Firebase listeners |
| [access-control.js](access-control.js) | Resolves real identity, email keys and current department roles |
| [dashboard.js](dashboard.js) | Sidebar panels, authorized department switcher, local video-poster capture/cache |
| [dashboard.css](dashboard.css) | Responsive iOS-inspired workspace styling and independent scroll regions |
| [browser-storage.js](browser-storage.js) | Firebase-like upload/delete adapter backed by the Worker, checksum and progress reporting |
| [media-management.js](media-management.js) | Publication, replacement, durable cleanup obligations and retries |
| [display.html](display.html) | TV playback, conditional REST metadata polling, layers, progress/audio/fullscreen controls |
| [media-cache.js](media-cache.js) | ES5-compatible IndexedDB/media-download/blob-URL ownership module |
| [serve-app.mjs](serve-app.mjs) | Loopback-only, explicit-allowlist development server |
| [tests/](tests/) | Access, lifecycle, display-sync and media-cache regression tests |
| [b2-migration/worker.mjs](b2-migration/worker.mjs) | Deployed Worker entrypoint and B2-backed Durable Object class |
| [b2-migration/quota-worker.mjs](b2-migration/quota-worker.mjs) | HTTP routing, CORS, ranges, authorization dispatch and ledger state machine |
| [b2-migration/b2-storage.mjs](b2-migration/b2-storage.mjs) | Native B2 authorization, streamed uploads, metadata/downloads and version deletion |
| [b2-migration/auth.mjs](b2-migration/auth.mjs) | Firebase JWT verification and fresh role lookups |
| [b2-migration/rules.mjs](b2-migration/rules.mjs) | Generates current destination RTDB security rules |
| [b2-migration/deploy-rules.mjs](b2-migration/deploy-rules.mjs) | Backs up and deploys rules to the explicitly named new project |
| [b2-migration/wrangler.jsonc](b2-migration/wrangler.jsonc) | Worker, account, bindings, SQLite migration and environment configuration |
| [b2-migration/build.mjs](b2-migration/build.mjs) | Optional isolated static-site build under the private migration directory |
| [b2-migration/migrate.mjs](b2-migration/migrate.mjs) | Guarded source export, migration planning, copy and hash verification |
| [b2-migration/serve-staging.mjs](b2-migration/serve-staging.mjs) | Local-only, short-lived migration login bridge; not production hosting |
| [b2-migration/tests/](b2-migration/tests/) | Unit tests and local workerd/SQLite integration harness |
| [r2-migration/](r2-migration/) | Abandoned R2 prototype; currently also holds the locked Wrangler tooling install |
| `.migration-private/` | Ignored snapshots, temporary builds, short-lived auth session and rule backups |
| `EGRESS_*`, `FIREBASE_MIGRATION_CHECKLIST.md`, `firebase-storage-cors.json` | Historical analysis and source-project migration artifacts, not current deployment instructions |

**Do not run the R2 prototype's `npm run deploy`.** Tool binaries happen to live
there, but every real Worker deployment must explicitly select
`b2-migration/wrangler.jsonc`. There is no root `package.json` or frontend bundler.

## Runtime and dependencies

- Static HTML/CSS/JavaScript frontend; no React/Vue build or application server.
- Admin is modern JavaScript: promises, async/await, optional chaining, Fetch,
  Web Crypto, canvas, Blob/File APIs and modern DOM/CSS features.
- Display/cache code preserves ES5 syntax for older signage engines; this is not
  a guarantee that every Smart TV supports all required browser/media APIs.
- The reported target TV browser is **Android WebView 66 / approximately Chrome
  66**. That identification came from operator testing/history, not an independent
  firmware inspection. Keep this target separate from the modern admin dashboard;
  never load dashboard assets or module scripts into the TV page. Display controls
  use margin-based flex spacing; unsupported blur retains translucent backgrounds.
- Node.js is required for the local server and tooling. Development was exercised
  with Node `24.21.0`; the repository does not declare/enforce an engine range.
- Firebase compat web SDK `8.10.1` is loaded from `www.gstatic.com`. Admin/login
  use app, auth and database modules; the root admin no longer loads Storage SDK.
- PDF.js `2.16.105` is loaded from CDN for local PDF rendering/conversion.
- Font Awesome `6.4.0` is loaded from CDN for dashboard icons.
- Wrangler is declared under `r2-migration/package.json`; the checked-in lockfile
  used during this work resolves `4.154.0`. Use `npm ci`, not an unreviewed upgrade.
- Acorn is a development-only dependency in that tooling package. The legacy
  display regression test parses TV scripts as ES5; no parser is shipped to TVs.
- Workers runtime provides Web Crypto, streams, `FixedLengthStream`, Fetch and
  SQLite-backed Durable Objects. Compatibility date is `2026-10-28`.

External CDN scripts and Google sign-in need connectivity. A previously cached
playlist/media set does not make the entire first-time application install or
admin login offline-capable. There is no service worker/PWA installation flow.

## Local development

From the repository root in PowerShell:

```powershell
node --version
node serve-app.mjs
```

Open:

- Login: `http://127.0.0.1:5502/`
- Dashboard: `http://127.0.0.1:5502/admin.html`
- Direct authorized dashboard: `http://127.0.0.1:5502/admin.html?dept=cse`
- Display: `http://127.0.0.1:5502/display.html?dept=cse`

An optional port can be passed: `node serve-app.mjs 5503`. The server binds only
`127.0.0.1`, supports GET/HEAD, sends `Cache-Control: no-store` for app assets and
serves only its explicit filename allowlist. It deliberately does not expose
private snapshots, credentials, migration scripts or arbitrary repository files.
Restart it after changing its allowlist; source HTML/CSS/JS edits are read on
subsequent requests. Stop with Ctrl+C. Use Ctrl+Shift+R after UI changes.

`127.0.0.1` on a TV refers to the TV, not the development computer. This server
is not LAN hosting or production hosting. Do not expose the whole repository
with an unrestricted file server to work around this.

The app talks to real configured cloud services; there is no automatic emulator
mode. Use disposable test content and the correct cloud account.

## Configuration and secrets

### Configuration locations

1. `index.html` and `admin.html`: Firebase `firebaseConfig` objects.
2. `display.html`: database URLs for department discovery and REST metadata.
3. `admin.html`: `PanelB2Storage(auth, MEDIA_API)` endpoint.
4. `b2-migration/wrangler.jsonc`: Worker account/name, project/database, bucket
   identity, allowed origins and byte limits.
5. `b2-migration/firebase.config.json` and `staging.config.json`: migration setup
   information. These files do not automatically configure the root frontend.
6. `b2-migration/config.local.json`: ignored migration/build configuration; obtain
   it privately or construct it from the documented fields below.

Changing one file does not synchronize all configuration locations. A project
or endpoint rename must be propagated deliberately and tested.

| Worker variable/binding | Meaning |
| --- | --- |
| `FIREBASE_PROJECT_ID` | Required JWT audience/issuer project |
| `FIREBASE_DATABASE_URL` | Fresh membership/role lookup database; no trailing slash |
| `B2_BUCKET_NAME`, `B2_BUCKET_ID` | Exact restricted-key bucket identity |
| `ALLOWED_ORIGINS` | Comma-separated exact origins; no path component |
| `ALLOW_LOCALHOST` | String `true` additionally permits HTTP `localhost`/`127.0.0.1` origins with optional ports |
| `STORAGE_LIMIT_BYTES` | Global tracked used + reserved budget; currently `1000000000` |
| `MAX_FILE_BYTES` | Per-upload server ceiling; currently `83886080` (80 MiB) |
| `QUOTA` | SQLite Durable Object binding to `MediaQuota` |
| `B2_KEY_ID`, `B2_APPLICATION_KEY` | Worker secrets, never public frontend variables |

Current exact production-origin allowlist includes `https://samjoshua7.github.io`.
Custom domains/preview hosts require an explicit CORS update and Firebase Auth
authorized-domain update. Consider disabling `ALLOW_LOCALHOST` for a distinct
production-only Worker once development and production are separated.

### Credentials

Firebase web API keys/project IDs/auth domains are frontend configuration, not
substitutes for security rules. B2 application keys, Firebase ID/refresh tokens,
gcloud OAuth tokens and Cloudflare OAuth/API credentials are secrets.

- Keep B2 bucket private and use a non-master key restricted to that bucket.
- Required adapter capabilities are `readFiles`, `writeFiles`, `deleteFiles`.
- Do not grant account-wide access just to fix an authorization error. The adapter
  rejects unrestricted or multi-bucket keys; an omitted bucket name is allowed
  only when the exact returned bucket ID matches.
- Never put B2 credentials in HTML, localStorage, a public JSON file, a CLI
  argument, screenshots, a README or chat.
- `.gitignore` excludes `.migration-private/`, Wrangler state, local config and
  `.dev.vars*`; it does not detect arbitrary secret filenames. Inspect staged
  changes before every commit.
- Worker logging is intentionally limited; tail output can still contain request
  metadata. Never share raw authenticated request logs or private snapshots.

## Authentication and authorization

### Login and department routing

Google sign-in uses Firebase Authentication. The login page passes an optional
normalized department hint to the admin page, not a fabricated `dept=null` URL.
The admin waits for Firebase auth state, requires a verified email and resolves
membership from the database before showing its workspace.

Department keys are normalized to lowercase `[a-z0-9_-]+`. Missing/empty values,
literal `null`/`undefined` and syntactically invalid hints become no selection.
Unknown departments open selection; a known department without membership is
denied. A single authorized department is selected automatically; multiple
departments appear in an authorized-department popup. The sidebar switcher uses
the same resolved membership list. Department names are database-driven, not a
hardcoded list of engineering branches.

Email keys use:

```javascript
email.toLowerCase().replace(/\./g, '_').replace(/@/g, '_')
```

For example, `person@example.com` becomes `person_example_com`. Records must
retain the real email too: authorization compares it with the verified identity.
The key scheme is not collision-proof; do not silently overwrite colliding keys.

| Role | Record location | Current authority |
| --- | --- | --- |
| Auth/editor, level `1` | `dept/{dept}/users/{emailKey}` | Department content/settings/cleanup writes and media upload/delete |
| Master, level `2` | Same department users node | Editor capabilities plus department user management |
| Global Super Admin, level `3` | `users/{emailKey}` | All departments, department creation, global and department users |

An authorization record needs `active: true`, a matching email and an accepted
role. Global levels 1/2 do not bypass department membership in the frontend.
Role-1 accounts are not server-limited to slides alone: current rules also allow
background/music/settings/cleanup changes. Do not infer authority solely from
button labels. Session storage carries display/convenience values, not authority.
The open admin watches its own global/department role records and reloads on
changes; signing out redirects away.

### Database enforcement

`b2-migration/rules.mjs` generates rules with default root read/write denial:

- Public: department catalog and active media/settings/background/music reads.
- Private: archived media and cleanup jobs, readable/writable by department
  editors or global Super Admins.
- Global user collection: Super Admin read/write; signed-in verified users can
  read their own individual record, including absence of a record.
- Department user collections: Master/Super Admin management; verified users can
  read their own individual membership record for routing.
- Department records validate email/active fields and role levels 1 or 2.
- Active/archived media have an `order` index.
- Rules are granted on specific child nodes; reading a whole `dept/{dept}` parent
  is not equivalent to reading its permitted children and can be denied.

Do not paste historical public/authenticated-write-all rules into the new
database. UI rate limits and hidden buttons are not security boundaries.

### Worker enforcement

Every object mutation and usage request requires `Authorization: Bearer
<Firebase ID token>`. The gateway verifies RS256 signatures with Google's Secure
Token JWK endpoint and checks project audience, issuer, expiry, issued/auth
times, subject and verified email. JWK caching respects the provider TTL with a
one-hour ceiling. Membership is read freshly from RTDB using that token, not
from caller-supplied roles. Global active role >=3 is accepted by the Worker;
otherwise it requires an active matching department record with role >=1.
The stricter frontend currently accepts exact global 3 and department 1/2;
preserve valid role values and review this asymmetry before expanding roles.

The Durable Object is reachable through the authenticated Worker binding, not a
separate public namespace endpoint. Public media delivery does not require auth.

## Firebase data model

```text
/
├─ depts/{departmentKey}: true
├─ users/{emailKey}: { email, role: "super", roleLevel: 3, active }
└─ dept/{departmentKey}/
   ├─ users/{emailKey}: { email, role: "auth"|"master", roleLevel: 1|2, active }
   ├─ media/{slideId}: Slide                       # active playlist
   ├─ disabled_media/{slideId}: Slide              # archive, not polled by TVs
   ├─ background: { url, storagePath, ... }        # ONE object, not a collection
   ├─ music: { url, storagePath, name?, ... }       # ONE object, not a collection
   ├─ settings/transition: "cut"|"fade"
   └─ cleanup_jobs/{pushId}: CleanupJob
```

Common media slide fields:

```json
{
  "type": "video",
  "url": "https://panelsync-b2-staging.fxodapp.workers.dev/media/panelsyncclassic/cse/slides/unique.mp4",
  "storagePath": "panelsyncclassic/cse/slides/unique.mp4",
  "name": "Department introduction.mp4",
  "order": 1,
  "duration": 42.5,
  "useBackground": false,
  "useMusic": false
}
```

`type` is `image`, `video` or `text`. Image/text duration is in seconds. Video
duration is optional metadata; playback advances on `ended`, not just a fixed
configured timer. Text uses `content`, `bgColor`, `textColor` and does not need a
media URL/path. Archived records carry `disabled: true`; enabling removes that
flag and moves the record back. Migrated records may include `storageProvider:
"b2"`, `byteSize` and `sha256`; these are migration-verification metadata, not
universally populated fields on every new browser upload.

Cleanup jobs contain `storagePath`, `createdAt`, `reason`, optionally
`uploadUntil`, `error` and `lastAttempt`. Times are JavaScript epoch milliseconds.
They are durable obligations, not uploaded files or a guaranteed background queue.

## Media management lifecycle

### Upload and publish

1. Browser validates file category, extension, MIME and UI size/count limits.
2. For video, local metadata duration detection has a 15-second deadline and an
   additional seek attempt for fragmented MP4s with initially unknown duration.
3. A new immutable path uses department/folder plus a timestamp/random suffix.
4. Before upload, a Firebase cleanup job records the path with a 15-minute active
   upload window. An abandoned browser upload is therefore discoverable.
5. Browser computes SHA-1 using Web Crypto and uploads to the gateway with file
   length, MIME and checksum. XHR reports progress; timeout is ten minutes.
6. Worker authorizes, reserves quota atomically, streams into B2 and validates
   B2's returned name, size, checksum and file ID.
7. Successful publication atomically writes the active Firebase record and clears
   matching upload-tracking jobs.
8. On a lost database response, management code re-reads publication state before
   deleting any newly uploaded bytes. Uncertain state is reported, not assumed
   to be a failed commit. Rollback is best-effort; durable jobs support later
   reconciliation when available.

PDFs are rendered locally: page 1 is previewed; each page is rendered at scale
2 and encoded as JPEG quality 0.9 for its own image slide. PDF bytes are not
uploaded as playable display media. A multi-page PDF is not an all-or-nothing
transaction: earlier pages may already be published if a later page fails.
PPT/PPTX has a helper workflow, not native in-browser PowerPoint conversion.

### Disable / enable

An atomic RTDB multi-path update moves a slide between `media` and
`disabled_media` using the same ID. Disabling is **not deletion**: its B2 file
and quota usage remain so it can be re-enabled. TVs read only active `media`;
the admin subscribes to both nodes and merges them for its library.

### Delete / replace / retry

```text
Firebase atomic update
  remove active + archived slide references (or background/music node)
  + create cleanup job
       ↓
Read remaining active/archive/background/music references in this department
       ├─ still shared → retain file, complete this cleanup obligation
       └─ unreferenced → authenticated Worker DELETE
                            ↓
                       delete B2 version and confirm absence
                            ↓
                       release used/reserved ledger bytes
                            ↓
                       remove Firebase cleanup job
```

Background/music replacement publishes the new reference and records old-file
cleanup together. A shared file must remain until its final reference is gone.
If a step fails, its job/error remains visible under System; Retry cleanup runs
it again. Cleanup also runs on dashboard initialization and every 60 seconds
while an authorized dashboard is open. Active upload jobs are skipped until
their window expires. There is **no independently running cleanup scheduler**.

A repeated delete that finds an unknown ledger object is not allowed to erase
arbitrary untracked B2 data. The browser adapter treats it as already complete
only if a subsequent public HEAD confirms the file is absent; otherwise it
reports administrator reconciliation is required.

This is a recoverable multi-service workflow, not a distributed transaction.
Concurrent writers and network outages can leave temporary residue. Reference
checks are department-local browser reads, not a global transactional reference
index. Do not manually share B2 paths between departments or mutate this prefix
with external writers. Deleting a current object does not purge offline browser
copies, historical snapshots, unrelated B2 versions or the old live Firebase
deployment. Never promise immediate deletion everywhere.

## Worker HTTP API

Base URL: the configured media API. Object keys must match:

```text
panelsyncclassic/{lowercase-department}/{slides|backgrounds|music}/{filename}
```

Keys are at most 240 characters; filenames use ASCII letters, digits, `_`, `.`,
`-`; traversal-like `..` is rejected. Use immutable new keys, not overwrites.

| Method and route | Authentication | Result |
| --- | --- | --- |
| `OPTIONS ...` | Origin policy only | `204` CORS preflight for accepted origins |
| `GET /media/{key}` | Public | Full `200`, single-range `206`, validator `304`, missing `404`, invalid range `416` |
| `HEAD /media/{key}` | Public | Metadata without body; range/validator behavior follows serving code |
| `PUT /api/object?key={encoded-key}` | Firebase ID token + role | `201` JSON `{ key, url, size }` after verified upload |
| `DELETE /api/object?key={encoded-key}` | Firebase ID token + role | `200` JSON `{ deleted: true }` after storage/ledger cleanup |
| `GET /api/usage?dept={dept}` | Firebase ID token + role | Global used/reserved/available/limit byte totals |

The usage result is global across departments, even though access is checked for
the requested department. It is not a per-department quota view.

PUT requires `Content-Type`, `X-File-Size` and lowercase 40-hex-character
`X-Content-Sha1`. If Content-Length is present, it must match the declared size.
Wrong size/type/checksum declarations return `400`; duplicate paths `409`;
capacity exhaustion `413`; authentication/authorization failures `401`/`403`.
Unknown tracked-state deletion returns `404`; ambiguous cleanup may return
`503`. Some upstream/configuration/runtime failures are intentionally mapped to
generic `400` responses; inspect safe diagnostics rather than assuming all 400s
mean invalid user input. Unsupported API methods return `405`.

Media responses use MIME from B2 metadata, Content-Length, `Accept-Ranges:
bytes`, a B2-version-derived quoted ETag and `Cache-Control:
public,max-age=31536000,immutable`. A supported single `Range` can be bounded,
open-ended or suffix-based. Matching `If-None-Match` yields 304; matching ETag
`If-Range` permits partial delivery. Multi-range requests are not supported.
If B2 returns `200` for a range covering the entire file, the adapter accepts it
only with offset zero and an exact response-length match, and the Worker wraps
it with the requested `206` headers. A real partial range returning an unrelated
whole body is still rejected. This handles browser `Range: bytes=0-` requests
without masking incorrect partial responses.
Immutable caching is why file replacement must create a new key/URL.

CORS allows Authorization, Content-Type, X-File-Size, X-Content-Sha1, Range,
If-None-Match and If-Range. It exposes length/range/ETag headers and varies on
Origin. Requests with a supplied unapproved Origin are rejected; absence of
Origin is not an authentication requirement for public media.

## B2 adapter and quota ledger

Native operations: `b2_authorize_account`, `b2_get_upload_url`, `b2_upload_file`,
download-by-name HEAD/GET and `b2_delete_file_version`. B2 auth is cached for an
hour in the adapter; authorization errors invalidate that cached auth where
handled. Upload targets are obtained server-side and validated as B2 hosts.

`FixedLengthStream` supplies an actual Content-Length and avoids buffering whole
videos inside the Worker's memory budget. The browser does buffer file bytes
for its checksum computation; this is not a zero-memory upload pipeline.

The `QUOTA` namespace has one named global ledger object,
`panelsync-global-quota-v1`. SQLite-backed Durable Object storage transactions
serialize ledger updates. Key `ledger` holds:

```javascript
{ used: 0, reserved: 0, files: {
  "panelsyncclassic/cse/slides/example.mp4": {
    size: 12345, state: "uploading", since: 1790000000000
  }
} }
```

States transition `uploading → stored → deleting → removed`. Deletion records
`previousState` temporarily. Reservations count immediately against capacity;
successful uploads move bytes from reserved to used. A verified deletion
subtracts from the appropriate counter. Failed/ambiguous PUT or cleanup retains
reservation rather than silently undercounting. An uploading reservation becomes
eligible for cleanup after 15 minutes; a still-active one is refused.

The adapter deletes an actual file version instead of issuing an S3 delete
marker. If an older version becomes visible afterward, deletion fails closed
and quota remains held for reconciliation. The ledger is not a live bucket
inventory: uploads through other tools, extra versions, retention/legal holds,
lost ledger state or namespace changes require operator investigation. Never
reset the ledger, change its object name or recreate the namespace merely to
make usage look lower. There is no general reconciliation endpoint yet.

## Display playback and caching

The display is a public client, not an authenticated admin session. It validates
department discovery and reads four child REST endpoints every 10 seconds:
`media`, `settings`, `background`, `music`. It does not listen to entire RTDB
roots or fetch archived media. Polling uses `X-Firebase-ETag: true`, retained
ETags and `If-None-Match`, avoiding overlapping requests and unchanged playlist
work. A 304 still consumes a request; conditional polling is not zero egress.

Metadata requests time out at 15 seconds and back off for 30 seconds after
failure. Saved metadata lives in localStorage as `panelsync-metadata:{URL}`.
Offline/transient failures can use previously saved metadata; online permission
denials must not be replaced with stale cached authorized data.

`media-cache.js` owns the local media lifecycle:

- IndexedDB database `PanelSyncClassicTVCache`, version 1, store `media_blobs`,
  keyed by complete source URL. Open fallback deadline: 8 seconds.
- Warm/preload and playback share a per-URL pending request instead of starting
  independent downloads. Preloading proceeds serially.
- Only full `200` responses with nonempty blobs and consistent length where
  provided are persisted; partial `206` is not treated as a complete cached file.
- Persistence is reported only after the IndexedDB transaction completes.
- Download idle guard: 45 seconds without progress; total XHR deadline: 10 minutes.
- On persistence failure, bounded volatile fallback is 96 MiB. Per-asset session
  failure suppression prevents repeated failed downloads from becoming a storm.
- Blob URLs are reference counted; stale asynchronous playback callbacks release
  their references rather than replacing a newer slide/background/audio request.
- Manual cache clear refuses while downloads are pending; current consumers
  retain their URLs until release. Clearing cache can force another download.
- Diagnostics are exposed as `PanelMediaCache.stats`; counters include hits,
  downloads, bytes, persisted files and failures. Do not print signed URLs.

There is no automatic guarantee of browser persistence, cache pruning after
deletion, storage retention across private browsing, or offline erasure.
Changing origin, scheme, port or source URL changes cache identity/storage scope.
Do not add random cache-busting parameters to recurring display URLs.

Playback uses two reusable layers for cut/fade transitions. Image/text slides
use durations; video readiness uses loaded-data/can-play/playing events so an
unknown/Infinity MP4 duration does not prevent starting. `ended` advances video;
45 seconds with no playback progress skips a stalled video. Display settings,
background/music and layer callbacks have guards against stale operations.
Audio/fullscreen can require user interaction; browser autoplay restrictions
are not bypassed. Real codec/WebView/TV compatibility needs hardware testing.

## Dashboard and previews

The desktop workspace uses independently scrolling sidebar controls and a slide
grid. Sidebar sections are Upload, Settings, Text slide, Background, Music and
System. System contains backend flow, cleanup, storage usage and privileged
user/department actions. Small screens use a responsive stacked layout. Both
active and disabled records remain visible in the slide library.

Before upload, local images/video/PDF page 1 can be previewed; temporary object
URLs are cleared/revoked when the selection is reset. Existing-slide preview
supports a 16:9 frame, previous/next navigation, arrow keys, Escape, text editing
and enable/disable. Generation/source checks ignore stale preview error events;
loading failures offer Retry without changing the slide record.

Video grid cards initially show a filename/duration/play hint, not an invisible
full-video preload. Explicit preview can capture a local 320×180 JPEG frame at
quality 0.65; captures over 60,000 characters are rejected. Up to 12 URL-keyed
posters are retained in localStorage `panelsync-video-posters-v1`. Posters are
browser-local, not uploaded B2 thumbnail objects or guaranteed first-frame
thumbnails on every device. Cross-origin/decoding/canvas failures retain the
descriptive fallback. Grid images are lazy loaded and reused on metadata-only
updates where possible. Do not assign every video URL to a grid video element.

## Limits and failure behavior

| Guard | Current implementation |
| --- | --- |
| Worker tracked storage | 1,000,000,000 bytes, used + reserved across all departments |
| Worker object size | 83,886,080 bytes / 80 MiB |
| UI image / MP4 / PDF selection | 10 / 80 / 25 MiB, respectively |
| UI background / audio selection | 10 / 15 MiB, respectively; the audio upload-area label still says 10 MB |
| UI slide count | 100 per department, including merged active/disabled items; client-side guard |
| Background/music count | UI permits one object each; replacement helper handles old references |
| UI slide/image/text durations | Inputs generally 1–600 seconds; video uses actual playback completion |
| Worker media types | JPEG, PNG, WebP, MP4; background images; MPEG/WAV/OGG audio by folder |
| PDF | Browser conversion to JPEG; not accepted as a Worker display object |
| B2 auth / ordinary API deadlines | 15 seconds / 20 seconds |
| B2 download deadline | 45 seconds waiting for response headers, not an entire healthy video body |
| B2 upload deadline | 10 minutes |
| Upload tracking / stale reservation window | 15 minutes |
| Dashboard cleanup retry | On initialization, manual retry, every 60 seconds while open |
| Client action-rate guards | Typically 5 uploads, 20 writes and 10 deletions per minute per local email/action key; not a server guarantee |

UI category limits are additionally passed through `validateFile` call sites in
`admin.html`; do not confuse an HTML label or client limit with a server policy.
MIME/extension checks are not malware scanning or codec validation. Client-side
localStorage rate limits are convenience guards and can be bypassed.

**No zero-bill or unlimited-delivery guarantee exists.** Application storage caps
do not cap bandwidth, requests, metadata reads, historical versions or the old
deployment's usage. Provider free-tier terms and configured account caps can
change or stop service. Verify the actual provider dashboards and routing usage;
the code does not implement or prove a particular invoice outcome. Keeping an
old deployment online can continue its old Firebase traffic after migration.
Choose a fail-closed service interruption over automatically upgrading a plan;
do not add paid bindings/subscriptions as an unreviewed dependency fix.

## Tests and acceptance

Read-only/local regression suite, from repository root:

```powershell
node --test tests/access-control.test.cjs tests/media-management.test.cjs b2-migration/tests/*.test.mjs
node --test tests/legacy-display.test.cjs
node tests/media-cache.test.cjs
node tests/display-sync.test.cjs
git diff --check
```

Coverage includes membership isolation, missing/null department hints, inactive
and unverified identities, role-3 behavior, cleanup failure/retry/shared-file
protection, upload tracking, JWT claims/signatures, quota concurrency/stale
reservations, B2 restriction checks/version deletion semantics, HTTP ranges,
CORS, generated script syntax, conditional metadata and cache ownership/reuse.
These tests use mocks for many provider behaviors; passing them is not proof of
an end-to-end Google login, a measured performance target or universal TV support.

Optional **local** Workers-runtime integration uses simulated B2 networking but
real workerd/SQLite. Install tooling first, then:

```powershell
& .\r2-migration\node_modules\.bin\wrangler.cmd deploy b2-migration/tests/runtime-worker.mjs --config b2-migration/wrangler.jsonc --dry-run --outdir "$PWD\.migration-private\b2-runtime"
node b2-migration/tests/runtime.mjs
```

The first command must retain `--dry-run`. `runtime-worker.mjs` is a fake backend
for tests and **must never be deployed**. Test harness imports currently rely on
the tooling installation under `r2-migration/node_modules`.

Live scripts require the ignored `config.local.json` and a current private
migration Firebase session:

- `node b2-migration/verify-staging.mjs`: read-only migrated-record, HEAD/MIME,
  range, CORS, directory denial and ledger checks. It assumes migrated records
  have verification fields and the ledger equals the referenced migrated set;
  new uploads/pending jobs can legitimately invalidate those assumptions.
- `node b2-migration/smoke-storage.mjs`: **writes and deletes** one unique tiny
  PNG and checks readback/deletion/accounting; not a read-only health probe.

Before a release, manually test with disposable content:

1. Google login, missing/null department hints, single/multiple memberships and
   a forbidden department URL. Test editor, Master, Super Admin and inactive user.
2. Upload image/MP4/text/PDF, preview before/after publication, edit/reorder,
   disable/re-enable and navigate preview without stale error messages.
3. Delete only the disposable file; verify active/archive records, B2 file,
   Worker usage and cleanup job completion. Exercise a disconnected/retry case.
4. Playback on actual signage hardware; wait for successful caching, reload,
   inspect network requests, try offline playback and reconnect.
5. Responsive layout, keyboard access, audio unlock and fullscreen.

User acceptance has reported working playback and dashboard behavior during this
migration. Do not treat that as a permanent automated release certification.

## Deployment and rollback

Frontend publication, Worker deployment and database rules deployment are three
independent operations. A PR merge may publish frontend assets depending on the
repository's actual GitHub Pages configuration; it does **not** deploy the Worker
or RTDB rules automatically. No checked-in CI deployment pipeline should be
assumed. Check repository Settings → Pages for the real source branch/workflow.

### 1. Install and authenticate tooling

```powershell
npm ci --prefix r2-migration
& .\r2-migration\node_modules\.bin\wrangler.cmd login
& .\r2-migration\node_modules\.bin\wrangler.cmd whoami
```

Inspect the returned account before deployment. Do not upgrade the account plan
or enable R2. gcloud authentication is separately required for rules/migration;
Cloudflare OAuth is not Firebase auth and a Google CLI token is not necessarily
accepted as an app Firebase login.

### 2. Configure the new Firebase project

For another environment, create/configure its project and RTDB deliberately;
enable Google sign-in; register a web app; authorize intended hostnames for Auth.
Start with locked RTDB rules. Through trusted administrative access, seed a
verified operator's global record (`email`, `active: true`, `roleLevel: 3`,
`role: "super"`) under its email key. Then deploy reviewed role-aware rules.
Do not make public writes available to let a browser bootstrap itself.

The checked-in rules deployment script is deliberately hardcoded to
`fx-panelsync` and its configured owner account, backs up current rules privately,
and is Windows-oriented. Review it before adapting it to another environment.

```powershell
gcloud auth login
node b2-migration/deploy-rules.mjs
```

Ensure the explicit account in that script is authorized. Do not run the migration
`prepare` command against an already populated destination: it intentionally
rejects databases containing media. Do not copy old permissive rules.

### 3. Configure and deploy the Worker

Review account, bucket/project identifiers, origins, limits, SQLite binding and
class migration in `b2-migration/wrangler.jsonc`. Back up state before changing
namespace identity or migrations. Use interactive secret prompts:

```powershell
& .\r2-migration\node_modules\.bin\wrangler.cmd secret put B2_KEY_ID --config .\b2-migration\wrangler.jsonc
& .\r2-migration\node_modules\.bin\wrangler.cmd secret put B2_APPLICATION_KEY --config .\b2-migration\wrangler.jsonc
& .\r2-migration\node_modules\.bin\wrangler.cmd deploy --config .\b2-migration\wrangler.jsonc
```

Never include secret values after these commands. Set frontend endpoint URLs to
the actual deployed Worker. `observability.enabled` is currently false; use a
short-lived `wrangler tail --config ...` session when diagnosing and stop it
afterward. Do not expose secrets or authenticated request logs in an issue/PR.

### 4. Publish frontend only after review

Publish these root assets together, preserving relative paths:

```text
index.html             admin.html             display.html
access-control.js      browser-storage.js     media-management.js
media-cache.js         dashboard.js           dashboard.css
```

Configure Firebase authorized domains and Worker allowed origins before trying
a new host. A GitHub Pages project URL includes its repository path; relative
asset links support that arrangement. Do not publish `.migration-private/`,
local credential files, test fake Workers or the repository's private directory
through an unrestricted static-host setup. Verify the published revision and
new-project-only configuration; a local file edit alone does not update Pages.

Current collaboration workflow: review this README and changes locally, then
explicitly approve a push/PR. A maintainer reviews and merges the PR; do not
auto-merge or treat documentation approval as permission to delete legacy data.

### Rollback

- Before release, save the exact frontend Git revision, Worker version, RTDB
  rules backup and a private metadata snapshot; protect snapshots as user data.
- Roll back the frontend and compatible Worker code deliberately. A code rollback
  does not restore deleted B2 objects or reset/repair the quota ledger.
- Restore reviewed rules only to the intended project. Avoid broad permissions
  as a temporary troubleshooting shortcut.
- Old source Firebase data was kept for the earlier deployed app. Retire that
  app and its specific resources only after an explicit cutover/retention review;
  the old project also contains unrelated application data.
- Do not unlink billing/delete the old project or wholesale erase its bucket as
  a PanelSync cleanup operation.

## Migration tools

These tools are for explicit migration, not routine application startup. Source
project/bucket identifiers are intentionally present in migration code. Root
runtime pages must remain configured only for the selected new backend.

Ignored `b2-migration/config.local.json` has this shape (use real environment
values privately; placeholders below are not deployable):

```json
{
  "firebase": {
    "apiKey": "WEB_API_KEY",
    "authDomain": "NEW_PROJECT.firebaseapp.com",
    "databaseURL": "https://NEW_DATABASE.firebaseio.com",
    "projectId": "NEW_PROJECT",
    "appId": "WEB_APP_ID"
  },
  "mediaApi": "https://YOUR_WORKER.workers.dev",
  "sourceAccount": "source-owner@example.com",
  "targetAccount": "destination-owner@example.com",
  "bootstrapAdminEmail": "destination-owner@example.com",
  "authRequestUri": "http://127.0.0.1:5501"
}
```

Commands, run only with explicit operator intent and the correct snapshot:

```powershell
node b2-migration/migrate.mjs export SOURCE_ACCOUNT_EMAIL
node b2-migration/migrate.mjs plan b2-migration/config.local.json SNAPSHOT_PATH
node b2-migration/build.mjs b2-migration/config.local.json
# Writes destination data/media; review plan first:
node b2-migration/migrate.mjs copy b2-migration/config.local.json SNAPSHOT_PATH --apply
```

Exports include only PanelSync `depts`, `dept`, `users` and source rules; they do
not constitute a whole-project backup of unrelated Firestore/other applications.
Snapshots include an integrity hash and remain under `.migration-private/`.
Inventory deduplicates active/archive/background/music references, validates the
expected source bucket/path, and rejects foreign media/thumbnail cases it cannot
safely rewrite. The copy process guards the destination against conflicting data,
copies bounded files, checks full SHA-256 readback, rewrites URLs, and imports
final metadata only after verification. It has no source delete/write workflow.

The initial Google CLI-token-to-Firebase sign-in exchange was rejected during
setup. `serve-staging.mjs BUILD_DIRECTORY` supplies a loopback migration sign-in
page at port 5501 as an alternative. It restricts origin/host, uses a nonce,
verifies destination JWT/email, bounds request size and expires the token-
accepting route after 15 minutes. Saved short-lived session is ignored at
`.migration-private/firebase-migration-session.json`; never send it to chat or
publish it. Refresh by signing in again when expired. Static staging server
allowlists must be updated if new UI assets are added; prefer `serve-app.mjs`
for current root development. Never expose the migration login bridge publicly.

The historical verified migration copied 3 departments and 9 unique files,
95,052,060 bytes, with matching hashes. That is a dated migration receipt, not a
live inventory or expected permanent quota value.

## Troubleshooting

| Symptom | Inspect / safe action |
| --- | --- |
| Google prompt or data still references `civic-voice` | Check browser URL, served revision and all root Firebase configs. Old Pages/staging tabs do not become new deployments automatically. If only consent branding differs, inspect Google/Firebase project branding rather than assuming storage routing from the label. |
| Local link refuses connection | Run `node serve-app.mjs`; keep that process alive; confirm port 5502 and same computer. A local server is not a cloud URL. |
| `?dept=null` / empty hint | Current normalization should open authorized selection. Hard refresh the new app and check that new `access-control.js` was served. Never grant a department to fix routing. |
| Access denied | Verify real Google account, verified email, active record, correct email key/record email, role and department. Session storage edits are not a fix. |
| Video card has no frame | Expected before local frame capture; use filename/duration and explicit Preview. Check CORS/canvas/codec if capture remains unavailable. |
| Intermittent preview error | Check Network status/MIME/ranges and Worker CORS; use Retry. Stale preview events are guarded, but real network/service/codec failures remain possible. |
| Upload preflight fails | Check exact Origin versus Worker config and Firebase authorized domain separately; these are different settings. |
| Upload `413` | Check file ceiling and global used + reserved quota. Do not erase reservations to force another upload. |
| Duplicate path `409` | Generate a genuinely new immutable path, or inspect the previous operation; do not overwrite cached URLs. |
| Pending cleanup / `503` | System → Retry cleanup; inspect reservation age, B2 capabilities, extra versions/retention and remaining references. Keep obligation records until resolved. |
| Empty UI after switching account | Wait for Firebase auth/role resolution; inspect denied requests and active role records. Do not bypass the gate. |
| Video reload downloads again | Verify successful IndexedDB commit, origin/URL stability, browser storage policy/quota and cache statistics. An UI caching message alone is not proof of persistence. |
| LCP is poor but CLS is zero | Measure actual network/CPU and lazy images on target hardware. Metrics are not proof of auth/backend failure or a guaranteed responsiveness score. |
| CSP `unsafe-eval` error from extension `content.js` | Determine whether a browser extension emitted it; do not weaken app CSP or enable unsafe-eval without tracing the source. |
| Disable/edit works in UI but not on TV | Check correct department/project, active `media` node, REST permissions, polling backoff/connectivity and deployed revision. |

## Security and maintenance backlog

Known limitations should remain visible during handoff rather than being
misrepresented as completed guarantees:

- Public media/active metadata and request-based delivery can be abused; there
  is no display-device authentication, signed playback policy, WAF/rate-limit
  layer or download-byte cap implemented here.
- Dashboard cleanup requires an online authorized browser; consider a separately
  designed server reconciler if stronger eventual-cleanup guarantees are needed.
- Firebase rules enforce roles but are not a complete schema/size validator for
  every content field. Review data validation, output escaping and malicious
  authorized-editor input before expanding trust boundaries.
- Reference checks and ordering edits are not global cross-service transactions;
  concurrent administration needs additional race testing.
- The email-to-key scheme can collide; a future UID/normalized-identity migration
  needs a deliberate compatibility/data migration plan.
- Worker JWT key caching does not force an immediate refetch for every unknown
  signing key ID; provider key rotation/transient auth errors need investigation.
- Bucket version/ledger reconciliation and bucket inventory auditing are manual;
  immutable app paths do not prevent external writers from creating extra copies.
- Provider account caps, billing state and real B2-to-Cloudflare transfer usage
  are operational responsibilities, not proven by a successful HTTP response.
- The legacy R2 directory still owns tooling dependencies. Move tooling into a
  clearly named package in a separate reviewed change; do not deploy the prototype.
- Root and migration browser adapters are duplicated. Keep them synchronized
  deliberately until a single-source build/tooling refactor is implemented.
- Some admin operations remain inline in a large HTML file; CDN dependencies,
  accessibility/focus management, performance and broader end-to-end tests merit
  ongoing work. Do not claim all admin JavaScript is ES5-compatible.
- No current service worker, automatic offline device purge, universal codec
  transcoding, centrally generated thumbnail service or formal uptime SLA exists.

For changes, identify which layer owns the behavior, add the relevant regression
test, avoid touching the old shared Firebase project, and document migrations or
new permissions before release. Never commit private data to make reproduction
easier.

## License

Apache License 2.0; see [LICENSE](LICENSE). Review external dependencies' own
licenses and terms separately.
