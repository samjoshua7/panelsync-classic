# Firebase migration safety inventory

Read-only inspection: 2026-10-28. Source project: `civic-voice-530e3`.
No cloud configuration, rules, billing link, object, user or application configuration was changed.

## Critical decision before migration

A different Google login is not a different Firebase project and does not remove a project's billing association. A genuinely new Spark project with no linked billing account avoids pay-as-you-go Firebase usage charges, but cannot provide the Cloud Storage backend used by this app.

Current official requirements say Cloud Storage for Firebase requires Blaze. Therefore choose one architecture before creating/importing a destination:

1. Strict no-linked-billing route: Spark for supported Firebase features such as Google sign-in and Realtime Database within quotas; move image/video/audio storage and the admin upload workflow to a separately verified backend, for example an existing college LAN server. Reaching free-plan limits can interrupt service rather than permit paid overage.
2. Keep the current Firebase Storage architecture: destination needs Blaze and a linked billing account. New account ownership does not make usage non-billable. Cache optimizations and monitoring reduce exposure but do not guarantee a zero bill.

An ordinary alerts-only budget does not cap spending. The currently documented Firebase spend-cap feature does not list Cloud Storage or Realtime Database and is not an instantaneous hard monetary limit even for supported services.

Sources:
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://firebase.google.com/docs/projects/billing/spend-caps
- https://docs.cloud.google.com/billing/docs/how-to/modify-project

## Verified source inventory

| Area | Verified finding | Migration consequence |
| --- | --- | --- |
| Billing | Project has billing enabled and a linked Cloud Billing account | Switching CLI login or owner does not unlink billing. Actual invoice amount has not been inspected. |
| RTDB | Root contains `depts`, `dept`, `users` | Preserve all three, not just slide metadata. |
| Departments | `civil`: 3 active slides, background, music, 1 department-user record; `cse`: 2 active slides, background, music, 4 department-user records; `dev`: 3 active slides, no background/music, 1 department-user record | Counts are point-in-time; re-inventory during an upload/edit freeze. |
| Archive data | No disabled slide records found in the three department inventories | New code expects `disabled_media`; rules currently do not support it. |
| Bucket | `civic-voice-530e3.firebasestorage.app`, `US-CENTRAL1`; 19 current objects listed | Includes more than PanelSync. Do not copy/delete everything indiscriminately. |
| Shared storage | 9 `complaints/` objects; remaining objects under `panelsyncclassic/`, including a zero-byte folder placeholder | Another application's files are present. Scope PanelSync migration separately. |
| Storage retention | Seven-day soft-delete retention configured | Deletion is not proof of immediate storage-cost elimination. Verify retained data separately before cleanup. |
| CORS | Bucket metadata returned no CORS configuration | Destination needs deliberately configured browser-read CORS if using cross-origin Blob downloads. This also remains an issue for current persistent caching. |
| Cache metadata | New `dev` image/video have explicit immutable Cache-Control; older listed media do not | Preserve or deliberately normalize object metadata; do not assume the upload-code change updated old files. |
| Firestore | Default native database in `asia-south1`; root collections `complaints` and `users` | Not used by the reviewed PanelSync code, but demonstrates shared-project dependencies. Do not remove or change billing without considering this app. Document contents not inspected. |
| Firebase web app | One registered web app, display name `civic-voice-web`, app ID `1:445788979324:web:7d454068b866150f0c49f9` | Current PanelSync reuses this registration. Destination needs its own configuration. |
| Authentication | Google provider enabled | Recreate provider configuration and verify sign-in; cloud-project IAM membership is separate from app-user access. |
| Authorized domains | Source Firebase domains, `127.0.0.1`, `samjoshua7.github.io`, `192.168.1.41` | Revalidate actual production/LAN origins. Do not blindly carry obsolete domains forward. |
| Hosting | Default Firebase Hosting site exists at `civic-voice-530e3.web.app` | Existence does not prove current PanelSync deployment there. GitHub Pages is also an authorized sign-in domain; actual TV URLs and deployment source remain to confirm. |
| Local backup | Ignored `firebase_db.json` is only 191 bytes and contains `users`/`depts`, not a full `dept` export | It is NOT a complete current migration backup. Do not rely on it. |

API access initially returned 403 for several Firebase-management requests; explicitly setting the quota-project request header allowed subsequent read-only inventory. These initial errors were not proof that resources were absent.

## Rules that must not be copied blindly

### Realtime Database

Current rules allow public reads for department discovery and active media/settings/background/music, consistent with the unauthenticated TV code. Writes there require only `auth != null`.

Global and department `users` nodes also allow writes by any authenticated user. Client UI role checks and `sessionStorage` are not an authorization boundary. A signed-in user could attempt to edit access/role data directly. The destination must enforce trusted administrator permissions in server-side rules, with a tested bootstrap path and department isolation.

`disabled_media` is absent from the deployed rules. With no granting parent rule, ordinary app clients cannot read/write that node; the atomic disable/enable update can therefore fail. Verify both archive subscriptions and atomic moves with authenticated rule tests.

### Storage

The deployed rule for `panelsyncclassic/{dept}/{folder}/{allPaths=**}` allows public reads and permits writes by any authenticated user. This is not department/admin authorization. No complaints-path grant was present in the inspected Storage ruleset; the other application's access mechanism has not been established.

Never deploy blanket public-write rules as a migration shortcut. CORS is not authentication, a billing limit or a replacement for rules.

## Pre-cutover verification checklist

- [ ] Decide destination architecture and billing status; explicitly verify no linked billing account if that is the requirement.
- [ ] Confirm whether only PanelSync or the whole shared Civic Voice project is in scope.
- [ ] Identify actual admin URL, TV URLs/origins, deployment repository/branch, hosting provider and all physical displays/profiles.
- [ ] Freeze source uploads/edits for the final export, or define a tested delta-copy procedure.
- [ ] Export complete RTDB data, its rules and relevant indexes; validate JSON parsing and record counts. Store access records privately, outside Git.
- [ ] Inventory Firebase Authentication accounts, provider identities, UIDs, disabled status and custom claims. Decide whether to preserve accounts/UIDs or require a controlled new Google sign-in; do not confuse Auth users with RTDB email-keyed role records.
- [ ] Back up only intended media, including background/music and any disabled slides. Record object path, byte size, generation, checksum, MIME type and required metadata. Compare hashes after transfer.
- [ ] Rewrite every migrated media URL to the destination; preserve/replace `storagePath` appropriately. Changing `firebaseConfig` alone does not rewrite database-stored download URLs.
- [ ] Create fresh destination download URLs/tokens when applicable. Do not assume changing just the bucket hostname preserves working tokens. Keep token-bearing manifests private.
- [ ] Cover legacy array and current object-shaped playlists, ordering, text colors/content, durations, background/music flags, transitions, departments, global users and department users.
- [ ] Register destination Firebase web app; update both `index.html` and `admin.html` configs and all hard-coded RTDB endpoints in `display.html`.
- [ ] Configure Google sign-in, authorized domains, OAuth consent/client details and any API-key restrictions; verify admin sign-in from actual deployed origins.
- [ ] Review App Check enforcement, IAM roles, service accounts and any other apps before enabling or removing access. These have not been fully audited.
- [ ] Deploy least-privilege RTDB/Storage rules and needed indexes. Test unauthenticated TV reads, rejected unauthorized writes, administrator actions, department isolation, bootstrap and archive atomic updates.
- [ ] Verify target media service: browser GET CORS, byte ranges, MIME type, immutable/versioned paths, cache headers, upload permissions, limits and outage behavior.
- [ ] Verify source media decoding and target playback on the actual TV; no media-body downloads were made during this inventory.
- [ ] Deploy `media-cache.js` with the updated HTML, not HTML alone.
- [ ] Expect one cold-cache download for changed URLs; test first loop, second loop, normal reload, offline reload, quota failure and stalled video. Use Storage body bytes, not request count, as the egress evidence.
- [ ] Scan code AND imported database records for old project/bucket references. Check previously saved browser metadata/IndexedDB too; old tabs still running old code can keep using the old project.
- [ ] Confirm all TVs/admin sessions have moved. Check old-project traffic before declaring the switch complete.
- [ ] Verify rollback using private source backups. Do not delete the source or revoke its URLs before target acceptance.
- [ ] Only after shared-app impact review and explicit approval: retire old PanelSync access/URLs and decide whether the old billing link should remain. Migrating PanelSync alone will not stop the other app's usage.
- [ ] Inspect outstanding charges in Cloud Billing. Charges already incurred remain payable even after disabling billing, and can be reported later. Cancelling UPI autopay alone is not a cost-control design.

## Still unverified

Actual rupee charges, billing-account trial/paid status and budgets; Auth user counts/custom claims; API-key restrictions; complete IAM/App Check configuration; other buckets or RTDB instances; Firestore document counts and other-app production dependencies; deployed Hosting content/custom domains; source-to-destination backups/hashes; destination project configuration; real-browser/TV migration acceptance.

The screenshot's bandwidth metric is not an invoice. The current bucket region can qualify for Cloud Storage free-tier allowances, subject to current eligibility, account-wide usage and destinations; no zero-cost conclusion follows from the graph alone.

Free-tier reference: https://docs.cloud.google.com/free/docs/free-cloud-features#cloud-storage
