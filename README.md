# PanelSync Classic - Multi-Department Digital Signage

## Current local app (new backend)

The root HTML now uses Firebase `fx-panelsync` for Google sign-in and metadata,
Cloudflare Workers for authenticated media management, and private Backblaze B2
for media bytes. Firebase Storage / `civic-voice-530e3` is not used by this local
app. Historical Firebase-only instructions below describe the old deployment;
do not paste those rules into the new project.

Run `node serve-app.mjs`, then open http://127.0.0.1:5502/ . The published GitHub
Pages version does not change until the deployment branch is updated/published.
No push or publication is performed by the local server.

The dashboard verifies real Firebase identity and current department membership;
sessionStorage cannot grant access. Only global role 3 crosses departments.
Deleting media removes active/archive metadata and writes a cleanup job
atomically, then removes B2 bytes and its Worker quota entry. Failures remain
visible for retry, including abandoned uploads. Cleanup retries while an
authorized dashboard is open; this is not an always-running backend scheduler.

Independent services and offline devices cannot guarantee immediate removal of
every copy. Shared files remain until no playlist references them. Old deployed
Firebase media, historical backups and offline browser caches are not silently
purged. Do not claim unlimited free service: account caps and free quotas can
stop service, and the app storage cap is not a bandwidth/spend cap.

Tests: `node --test tests/access-control.test.cjs tests/media-management.test.cjs b2-migration/tests/*.test.mjs`,
`node tests/media-cache.test.cjs`, and `node tests/display-sync.test.cjs`.

## Overview

A scalable Firebase-based digital signage system supporting multiple isolated departments with background images and music.

## Features

- **Multi-Department Support**: Each department has isolated users, media, settings, backgrounds, and music
- **Background Images**: Optional background images for slides
- **Background Music**: Optional background music playback
- **Google Authentication**: Secure admin access
- **Real-time Updates**: Live content synchronization
- **Responsive Design**: Works on TVs, tablets, and computers

## Department URLs

Access different departments using URL parameters:

- `admin.html?dept=cse` — CSE Department Admin
- `admin.html?dept=civil` — Civil Department Admin
- `admin.html?dept=ece` — ECE Department Admin
- `display.html?dept=cse` — CSE Department Display
- `display.html?dept=civil` — Civil Department Display

Supported departments: `cse`, `civil`, `ece`, `eee`, `mech`, `it`, `chem`, `bio`

## Firebase Structure

```
{
  "dept": {
    "cse": {
      "users": {...},
      "media": {
        "slide_xxx": {
          "type": "image/text/video",
          "url": "...",
          "storagePath": "...",
          "duration": 5,
          "order": 1,
          "useBackground": true,
          "useMusic": false
        }
      },
      "backgrounds": {
        "bg1": {
          "url": "...",
          "storagePath": "..."
        }
      },
      "music": {
        "music1": {
          "url": "...",
          "storagePath": "..."
        }
      },
      "settings": {
        "transition": "fade"
      }
    }
  }
}
```

## Storage Structure

Files are stored department-wise in Firebase Storage:

- `panelsyncclassic/{dept}/slides/` — Media files
- `panelsyncclassic/{dept}/backgrounds/` — Background images
- `panelsyncclassic/{dept}/music/` — Music files

## Setup

1. **Firebase Configuration**: Update the hardcoded Firebase config in both files
2. **Google OAuth**: Replace `YOUR_GOOGLE_CLIENT_ID` with your Google OAuth client ID
3. **Authentication**: Add authorized users to `/auth-users` in Realtime Database

## Usage

1. **Admin Panel**: Upload media, manage backgrounds/music, configure settings
2. **Display**: Automatically cycles through department-specific content
3. **Backgrounds**: Enable per-slide to show department backgrounds
4. **Music**: Enable per-slide for background audio (videos default to no music)

## Compatibility

- Android WebView 66+
- Modern web browsers
- Smart TVs
- Tablets and computers

## Notes

- Uses ES5 JavaScript for maximum compatibility
- No external frameworks
- Firebase REST API for data access
- Automatic fullscreen on displays
