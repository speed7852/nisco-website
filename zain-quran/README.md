# Zain Quran PWA

This is a standalone, installable PWA served from the NISCO static Cloudflare Pages project at `/zain-quran/`. It does not replace the NISCO homepage or its Worker.

## Features

- Arabic Uthmani Quran text with Sahih International English translation.
- Reciter catalogue integration for Saud Al-Shuraim, Saad Al-Ghamdi, Yasser Al-Dosari and Mishary Al-Afasy.
- Full-Surah MP3 playback, verse navigation and repeat using provider ayah timings where available.
- Local bookmarks, daily reading goal, reading-time counter and consecutive-day streak.
- Installable app shell with service-worker caching.
- User-triggered Surah audio download into browser Cache Storage for offline listening.

## Content providers

- Quran text and translation: [Al Quran Cloud](https://alquran.cloud/api).
- Reciter catalogue, audio URLs and ayah timing metadata: [MP3Quran API](https://www.mp3quran.net/eng/api).

The app does not host or redistribute Quran or recitation files. The app streams from the provider's servers. Offline downloads are stored locally in the user's browser and depend on provider CORS behaviour, device storage and applicable provider terms.

## Deploy

The existing NISCO Cloudflare Pages project is configured as a static site with repository root as output. This app is a plain static directory, so it is available at `/zain-quran/` when the containing repository revision is deployed.

Install it from the browser's Install app / Add to Home Screen menu after opening the app over HTTPS.

## Privacy and data

No login, analytics or remote user database is used. Reading goals, streaks and bookmarks are stored in localStorage. Audio downloads are stored in Cache Storage on the current browser/device.

## Known limitations

- Streak and reading time are device-local. Reading time counts while the reader screen is visible; it does not sync across devices.
- Audio playback uses the provider's complete Surah file and timing metadata for verse-level navigation. If timing metadata is unavailable for a particular recitation, the app may play the Surah as a continuous recording.
- Offline download can fail if a provider blocks browser CORS requests or the device has insufficient storage.
- Push notifications and background reminder scheduling are not enabled.
