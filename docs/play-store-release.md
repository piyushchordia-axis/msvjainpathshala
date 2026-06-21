# Publishing to Google Play (EAS)

Simple runbook for shipping any of our Expo apps to the Play Store.

---

## Our shared credentials (reuse for every app — already created)

- **Google Play Developer account:** "Enaa Creations" (login `developers@enaacreations.com`)
- **Service account key:** `credentials/play-service-account.json`
  (email `eas-play-submit@alien-limiter-455106-g2.iam.gserviceaccount.com`)

You **do not** recreate these per project. Just copy the key file into each new project. The key already has release access to all apps in our Play account.

> One-time setup of these (only if starting a brand-new Google account) is in the Appendix.

---

## A. New project (do once per app)

1. **Create the app in Play Console**
   - Play Console → **Create app** → enter name, language, App/Game, Free/Paid → Create.
   - Fill the required declarations it asks for (content rating, privacy policy, data safety, target audience).

2. **Set the package name in `app.json`**
   ```json
   "android": { "package": "com.enaacreations.YOURAPP" }
   ```

3. **Add the key + submit config**
   - Copy `credentials/play-service-account.json` into the project's `credentials/` folder.
   - In `eas.json`:
   ```json
   "submit": {
     "production": {
       "android": {
         "serviceAccountKeyPath": "./credentials/play-service-account.json",
         "track": "alpha"
       }
     }
   }
   ```
   - `track` values: `internal` = Internal testing, `alpha` = Closed testing, `beta` = Open testing, `production` = Production. (If you made a **custom-named** closed track, use that exact track name instead of `alpha`.)
   - Make sure `credentials/` is in `.gitignore`.

4. **Build + submit the first AAB**
   ```bash
   eas build  --platform android --profile production --local   # or cloud (drop --local)
   eas submit --platform android --profile production --path build-*.aab
   ```
   - For **Jain Pathshala (Jun 2026)** the very first `eas submit` uploaded straight to
     the **internal** track — no manual console upload was needed. (Google's API used to
     require the first AAB by hand; that no longer applied here.)
   - If `eas submit` ever errors that the first release must be manual: Play Console →
     your app → **Test and release → Testing → Internal testing → Create release** →
     upload the `.aab` → roll out. After that, all future `eas submit`s work.

✅ Setup done.

---

## B. Every build after that (existing app)

1. (Only if it's a new version number) bump `version` in `app.json`. The build number auto-increments.
2. One command — builds **and** uploads to the internal track:
   ```bash
   eas build --platform android --profile production --auto-submit
   ```
3. **To release to the public Play Store:**
   Play Console → your app → **Production** → **Create release** → select the build you uploaded → **Review → Roll out to production**.

That's it.

---

## C. Store listing — what to prepare (once per app, reused on every update)

Google asks for this when you set up the Play Store page. Fill it **once**; later updates only change screenshots + a "what's new" note.

**Text**
- App name (30 chars), short description (80), full description (4000)
- **Privacy policy URL** — must be a live web page (required)
- Contact email

**Images**
- App icon — **512 × 512** PNG
- Feature graphic — **1024 × 500** PNG (required)
- Phone screenshots — **2 to 8**, portrait, **~1080 × 1920** px (clean screenshots straight from the app are fine)

**Questionnaires (fill once)**
- Content rating (short quiz)
- Data safety — what data the app collects
- Ads — does the app show ads? (yes/no)
- Target audience & age

**⚠️ If the app has login (ours does):**
Under **App access**, give Google a **test account** (username + password). Without it, the review gets **rejected** because the reviewer can't get past the login screen.

---

## Gotchas (so you don't get stuck)

- The "first AAB must be uploaded by hand" rule no longer bit us — `eas submit` pushed the first build to the **internal** track directly (Jun 2026). Keep the manual fallback in mind only if a fresh app's first `eas submit` ever errors.
- Permissions for a newly-invited service account can take a few minutes to activate — if a submit fails with a `403`, wait ~5 min and retry.
- Never commit the key — it lives only in the gitignored `credentials/` folder.

---

## Appendix — one-time account setup (only for a fresh Google account)

The service account key was created under a **personal Gmail** Cloud project on purpose, because our work org blocks downloadable keys. To recreate:

1. [console.cloud.google.com](https://console.cloud.google.com) signed in with a **personal Gmail** (no Workspace org).
2. Pick/create a project → **APIs & Services → Library** → enable **"Google Play Android Developer API"**.
3. **IAM & Admin → Service Accounts → Create** → name it → Done.
4. Open it → **Keys → Add key → Create new key → JSON** → save the downloaded file.
5. Play Console → **Users and permissions → Invite new users** → paste the service-account email → **Account permissions** → check the **Releases** permissions → **Invite**.
