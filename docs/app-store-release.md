# Publishing to the Apple App Store (EAS)

Simple runbook for shipping any of our Expo apps to the App Store.

---

## Our shared credentials (reuse for every app — already created)

- **Apple Developer account:** Apple ID `surbhichordia16@gmail.com`, Team `UL2P2A75SV` (Surbhi Chordia)
- **App Store Connect API key:** `credentials/AuthKey_75JR6GG22Q.p8`
  - Key ID: `75JR6GG22Q`
  - Issuer ID: `20f04c20-2b8f-4482-a782-f201f84c8ca5`

You **do not** recreate these per project. Just copy the `.p8` file into each new project.

> One-time setup of this key (only if starting fresh) is in the Appendix.

---

## A. New project (do once per app)

1. **Set the bundle ID + encryption flag in `app.json`**
   ```json
   "ios": {
     "bundleIdentifier": "com.yourcompany.YOURAPP",
     "infoPlist": { "ITSAppUsesNonExemptEncryption": false }
   }
   ```

2. **Add the key + submit config**
   - Copy `credentials/AuthKey_75JR6GG22Q.p8` into the project's `credentials/` folder.
   - In `eas.json`:
   ```json
   "submit": {
     "production": {
       "ios": {
         "ascApiKeyPath": "./credentials/AuthKey_75JR6GG22Q.p8",
         "ascApiKeyId": "75JR6GG22Q",
         "ascApiKeyIssuerId": "20f04c20-2b8f-4482-a782-f201f84c8ca5"
       }
     }
   }
   ```
   - Make sure `credentials/` is in `.gitignore`.

3. **First build — log in to Apple once**
   ```bash
   eas build --platform ios --profile production
   ```
   - When it asks **"Do you want to log in to your Apple account?"** → **Yes**
   - Enter Apple ID → password → the 6-digit 2FA code.
   - EAS auto-creates the distribution certificate, provisioning profile, and push key.
   - **This is the only time you log in interactively.**

✅ Setup done. All future builds are non-interactive.

---

## B. Every build after that (existing app)

1. (Only if it's a new version number) bump `version` in `app.json`. The build number auto-increments.
2. One command — builds **and** uploads to App Store Connect / TestFlight:
   ```bash
   eas build --platform ios --profile production --auto-submit --non-interactive
   ```
   (No Apple login prompt — the credentials already exist.)

3. **To release to the public App Store:**
   [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **My Apps** → your app:
   - Create the version (e.g. `1.0.1`).
   - Fill the listing: screenshots, description, keywords, privacy policy URL (first version only; later versions reuse most of it).
   - Under **Build**, click **＋** and select the build you just uploaded.
   - Complete **App Privacy** + **Pricing**.
   - **Add for Review → Submit for Review.**
   - Apple reviews in ~1–3 days, then it goes live.

---

## C. Store listing — what to prepare (once per app, reused on every update)

Apple asks for this on the app's App Store page. Fill it **once**; later updates only change screenshots + a "what's new" note.

**Text**
- Name (30 chars), subtitle (30), description (4000), keywords (100, comma-separated)
- **Privacy policy URL** (required) + **support URL** (required) — both must be live web pages

**Images**
- App icon — comes from the build automatically (the 1024×1024 icon inside the app)
- Screenshots — **1 to 10**, **iPhone 6.7"/6.9"** portrait = **1290 × 2796** px (iPad not needed — our app is iPhone-only). 3–5 clean screenshots is plenty; Apple scales them for smaller phones.

**Questionnaires (fill once)**
- Age rating (short quiz)
- App Privacy — what data the app collects
- Export compliance — already handled by `ITSAppUsesNonExemptEncryption: false` in `app.json`

**⚠️ If the app has login (ours does):**
In **App Review Information**, give Apple a **demo account** (username + password) + a contact name/email. Without it, the review gets **rejected** because the reviewer can't get past the login screen.

---

## Gotchas (so you don't get stuck)

- The **"Do you want to log in to your Apple account? (Y/n)"** prompt is **optional** on later builds — press **n** if credentials already exist, or just always use `--non-interactive` to skip it.
- An **app-specific password is NOT enough** to create signing credentials — the first build needs a real Apple login + 2FA (step A3). The `.p8` key handles submission only.
- Uploading the binary is automated; the public release (listing + "Submit for Review") is always a manual step in App Store Connect.
- Never commit the `.p8` — it lives only in the gitignored `credentials/` folder.

---

## Appendix — one-time account setup (only for a fresh Apple account)

To recreate the App Store Connect API key:

1. [App Store Connect](https://appstoreconnect.apple.com) → **Users and Access → Integrations → App Store Connect API → Team Keys** → **＋**
2. Name it (e.g. `EAS CI`), Access = **App Manager** → **Generate**.
3. **Download the `.p8`** (one-time download — save it) and note the **Key ID** + **Issuer ID**.
