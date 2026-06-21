# Store listing automation (fastlane)

These lanes upload the **App Store** and **Play Store** *listings* — metadata + screenshots — so you never hand-edit the web consoles again. They **do not** build or upload the app binary; EAS does that (`eas build --local` + `eas submit`).

Auth reuses the shared Enaa Creations keys already in `../credentials/` (the same ones `eas submit` uses). Nothing secret lives in this folder.

## Edit, then upload

1. Edit the text files under `metadata/` (iOS) and `metadata/android/` (Play). Each `.txt` file is one store field.
2. Drop screenshots in the folders below (see sizes).
3. Run one command:

```bash
cd apps/jain-pathshala-mobile

# App Store listing
fastlane ios metadata

# Play Store listing  (only works AFTER the Play app exists + 1 manual AAB upload)
fastlane android metadata
```

(Use `bundle exec fastlane …` if you want the pinned version from the Gemfile.)

Both lanes have `submit_for_review: false` — they update the listing only. Flip that in `Fastfile` (and fill `metadata/review_information/`) when you're ready to actually submit.

## Where screenshots go

**iOS** → `screenshots/en-US/` — any filenames; `deliver` detects the device by image resolution.
- iPhone 6.9": **1320 × 2868** (or 6.7": **1290 × 2796**), portrait. 3–5 is plenty.
- iPad not needed (iPhone-only app).

**Android** → `metadata/android/en-US/images/`
- `phoneScreenshots/` → `1.png`, `2.png`, … (2–8, portrait)
- `icon.png` → 512 × 512
- `featureGraphic.png` → 1024 × 500 (required by Play)

## Capturing screenshots

`deliver`/`supply` **upload** screenshots; they don't capture them. For now, capture once by hand (simulator/emulator or a real device) and commit them here — they're reused on every release until the UI changes. Fully automated capture (`snapshot`/`screengrab` via UI tests) is a later step; it needs the app running with seeded data behind login, which is blocked until the backend is hosted and real OTP login works.

## Gotchas

- **iOS** auth is the App Store Connect API key (`credentials/AuthKey_75JR6GG22Q.p8`) — no Apple password/2FA needed for listing uploads.
- **Android**: Google requires the **first** `.aab` of a brand-new app to be uploaded **by hand** in the Play Console once. `supply` only works after that.
- A live **privacy policy URL** is mandatory for both stores — `https://jainpathshala.enaacreations.com/privacy` must resolve before submission.
