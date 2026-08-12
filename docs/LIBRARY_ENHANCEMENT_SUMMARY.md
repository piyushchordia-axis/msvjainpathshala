# Library enhancement — the short version

*One page. The full engineering detail is in `LIBRARY_ENHANCEMENT.md` — your developer needs that one, you don't.*

---

## What changes

The library today is one long list of links, newest first. Every item kicks you out to a browser.

It becomes **folders with content inside them**:

```
Library
├── Stavan & Bhakti
│     ├── Navkar Mantra              audio
│     ├── The meaning of Navkar      text — reads inside the app
│     └── Advanced stavans           locked, members only
│
├── For new parents
│     ├── What is Pathshala?         text
│     └── Introduction               video — opens YouTube
│
└── Start learning
      └── Jain Values                jumps into the existing course
```

Six kinds of content: **text, audio, video, PDF, image, course link.** Text and audio play inside the app. Video, PDF and image open outside it. A course link drops you into the course you already have.

---

## What's different for people using it

**Guests see the whole library.** Today, anything gated is invisible to them — they don't know it exists. Now they see every folder and every title, with a padlock and a "Sign in" button on the ones they can't open yet.

This is the one change worth arguing about, so here's the reasoning: titles are advertising, not secrets. A guest who sees *"Advanced stavans — sign in to listen"* has a reason to sign in. A guest who sees nothing has no reason at all. The actual files stay locked exactly as tightly as they are today.

**Members get a library that's browsable.** Folders instead of a flat scroll, and articles that read in-app instead of bouncing to a browser.

**It works offline.** The whole catalogue and all the text content stay readable without a connection. Today the library is simply blank offline.

**Gurujis finally get one.** There's a teacher-only content tier in the system with no screen anywhere to reach it.

---

## What it costs

Roughly **seven pieces of work**, each shippable on its own without breaking anything:

1. Database changes — no visible change yet
2. The reading side of the API
3. The writing side of the API
4. Admin panel: a folder editor instead of a flat list
5. The mobile app
6. The public website
7. Cleanup — translations, offline, deleting old code

Phases 1–3 are invisible to users. The app only changes at phase 5.

---

## What you need to decide

Only three of these actually change what gets built. The rest have sensible defaults.

**1. Should text content support formatting?** Bold, headings, bullet points. Plain text is simpler and ships sooner; formatting matters if you're publishing a stavan with commentary underneath it. *Default: plain text now, with the door left open — no rework needed later.*

**2. Audio — uploaded files only, or external links too?** If Gurujis will paste Spotify or SoundCloud links, we should restrict which sites are allowed, the way YouTube and Vimeo already are for video. *Default: uploads only, which is the safest.*

**3. Should signed-in members see their extra content on the website too?** Right now the website's library is public-only — members only get the extra tiers on the phone. *Default: yes, make the website match the app.*

---

## What's deliberately left out

Worth knowing so you're not surprised:

- **Search.** Folders make browsing work; search is a separate project.
- **Only you can add content.** Everyone else — city admins, sanchalaks — still can't, because the library has no city or centre attached to it. Fixing that is a separate change and it's the biggest thing holding this module back.
- **Notifications when something new is published.** Blocked by the same missing piece.
- **Punya for reading.** Needs a rule for which child gets the points when a parent opens something, and a cap so it can't be farmed. That's your call, not a coding problem.
- **Videos and PDFs still open outside the app.** Audio and text open inside. Doing the same for video and PDF means adding new libraries to the app — a fair follow-up, not day one.

---

## Two things found along the way

Unrelated to this project, but you should know:

**Sanchalaks and city admins can currently see teacher-only library content.** The permission check asks "can this person open the admin panel?" when it should ask "is this person a teacher?" It's harmless today because gated content is hidden from everyone anyway — but it stops being harmless the moment the padlock UI ships. It's fixed as part of phase 2.

**In-app audio is free.** The app already includes an audio player for Niyam proof recordings. Playing library audio in-app needs no new dependency — just a screen.

---

*Nothing has been built. This is a proposal.*
