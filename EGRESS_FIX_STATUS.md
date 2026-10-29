# Egress fix status — 2026-10-28

## Implemented locally

- `media-cache.js`: shared ES5 IndexedDB cache; existing database, store and URL keys retained so existing valid cached files remain usable.
- Playback waits for IndexedDB initialization. Preloading and playback share one download and one committed write. Only complete HTTP 200 bodies are stored (not partial 206 bodies).
- Idle network timeout (45 seconds) and absolute download limit (10 minutes); progress shown while downloading. A failed asset is not repeatedly fetched by the cache during the same page session. Other assets are not blacklisted.
- Storage failures are distinguished from successful persistence. Up to 96 MiB of failed-write blobs can remain in session memory. This is not durable storage; a browser restart loses these blobs.
- Reference-counted Blob URLs; background/music reuse their current source; stale callbacks release acquired URLs. Layer cleanup is generation guarded.
- Videos advance on `ended`, can start with unknown duration, and skip after 45 seconds without playback progress. A partial seekable range is no longer presented as the full duration.
- RTDB conditional requests with ETags; overlapping polls prevented; network error backoff; unchanged responses do not rescan the media cache. Poll interval remains 10 seconds. Last successful metadata is saved for offline startup, including department validation; online permission denials do not fall back to old data.
- Admin cards do not attach video URLs. Explicit modal preview remains. Images lazy-load and reuse their DOM nodes across metadata edits when unchanged. Optional `thumbnailUrl` is used when present; no thumbnails have been uploaded/generated.
- User-management subscriptions are detached when switching the selected department.
- Antigravity's preview modal, local upload preview, disabled-media partition and existing visual styles retained.

## Automated verification

Run from the repository root:

```powershell
node tests/media-cache.test.cjs
node tests/display-sync.test.cjs
```

Tests use deterministic mocks: concurrent requests, persistence commit, object URL ownership, second-loop and fresh-page storage reuse, partial/invalid responses, network failure suppression, quota fallback, safe clearing, conditional polling, empty/disabled playlists, offline metadata and script syntax.

These tests are not proof of real TV codec support, browser storage persistence, production CORS or actual transferred bytes. No production video body was downloaded during this implementation.

Live read-only Firebase settings verification: initial GET returned HTTP 200; a subsequent GET using its ETag in `If-None-Match` returned HTTP 304 with a zero-byte response body. This verifies the server behavior, not browser/TV execution.

## Required next action

Google Cloud SDK is installed but no active authenticated account was found. Run:

```powershell
gcloud auth login
```

Sign in with an account authorized for `civic-voice-530e3`. Then the bucket's existing CORS configuration must be read before deciding whether to merge changes. Do not change Storage Rules or blindly replace existing CORS rules.

Cloud changes have NOT been applied. Existing uploaded-object Cache-Control metadata has NOT been changed. The existing `firebase-storage-cors.json` is a proposal, not evidence of the bucket configuration.

## Runtime acceptance still required

1. Serve the updated repository, including `media-cache.js` (do not deploy `display.html` alone).
2. In a real browser, first load may download each uncached active asset once. Confirm successful IndexedDB commits and no concurrent duplicate bodies.
3. Second loop: no Firebase Storage media-body transfers for cached files.
4. Normal reload/new browser instance on the same origin/profile: cached media still produces no remote media-body transfers.
5. Offline reload: previously saved department/playlist metadata and complete cached media play. New or uncached assets cannot play offline.
6. Toggle/edit a slide: unrelated images are not fetched again; admin grid downloads no videos until explicit preview.
7. Test actual TV: video plays to `ended`, transition cleanup does not clear a newer source, and stalled media skips rather than freezing indefinitely.
8. Record Storage body bytes separately from RTDB metadata bytes and request counts. Browser DevTools byte evidence remains pending.

## Remaining boundaries

- Native streaming fallback can still consume egress every loop when persistent caching is unavailable. The UI must not be interpreted as promising zero egress in that state.
- No automatic deletion of old cached assets yet: the database is shared across departments, so careless pruning would evict another display's media. Quota failures are bounded within a session but need real-device testing and a future department-aware storage budget.
- Existing full-size images and videos have not been resized/remuxed. A cold 63 MB video still takes time to download. Transcoding and thumbnails require an explicitly verified media-processing/deployment workflow.
- Cache keys remain the original URL for compatibility. Changing a token can cause a new download; uploads should use immutable, versioned paths, never replace bytes under an unchanged URL.
- No production deployment, Firebase rule change, CORS update, object metadata migration, media deletion or remux has occurred.
