# panelsync-classic

## Simple PanelSync Classic Demo

This workspace includes two lightweight static pages for a Firebase REST-backed signage demo:

- `display.html` — fullscreen TV view that cycles media from Firebase Realtime Database
- `admin.html` — simple admin panel for uploading files to Firebase Storage and managing the media list with Google sign-in

### Google sign-in

`admin.html` now uses Google Sign-In to authenticate the uploader. Replace `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` in the admin page with your own Google OAuth client ID.

### Storage bucket

This demo is configured to store media under the Firebase Storage bucket:

`gs://civic-voice-530e3.firebasestorage.app/panelsyncclassic`

In `admin.html`, uploaded files are stored under the `panelsyncclassic/` folder and then written to the Realtime Database.

### Setup

The Firebase Database URL and Storage bucket are now hardcoded in `admin.html` for convenience:

- Database: `https://civic-voice-530e3-default-rtdb.firebaseio.com/`
- Storage: `civic-voice-530e3.firebasestorage.app`

Just replace `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` with your Google OAuth client ID.

### Notes

- Uses plain HTML/CSS and ES5-style JavaScript only.
- No frameworks or modern JS syntax are used.
- Firebase Storage is uploaded via REST and the media list is stored in Realtime Database.
