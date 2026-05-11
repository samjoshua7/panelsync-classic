# PanelSync Classic - Multi-Department Digital Signage

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
