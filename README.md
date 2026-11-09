# Elite Massage Muscle Map

A local-first, zero-install web app: an interactive front/back muscle map that links muscles to the public YouTube videos of
**Elite Massage and Injury Rehab** (`@EliteMassageBoulder`). Official YouTube Data API v3 only. No scraping, no Instagram, no analytics.
Educational reference only; not diagnosis or medical advice.

## Run it (needs only Node 22.18 or newer; no `npm install`)
    npm start                 # http://localhost:3000   (binds to 127.0.0.1 only)
    npm test                  # 84 unit/integration tests (incl. regression fixtures of real channel titles)
    npm run e2e               # optional browser tests (needs: pip install playwright && playwright install chromium)
    npm run sync:youtube -- --full | --dry-run      # CLI sync (default: incremental); add --collection=yoga or --collection=release to sync one channel
    npm run titles -- https://youtube.com/@handle    # download every upload title of a channel into a .txt file (official API, ~1 quota unit per 50 videos)
    npm run match-report -- titles.txt               # dry-run the yoga matcher on a titles file: coverage + what is skipped (no database, no network)
Data lives in `data/app.db` (git-ignored). Node's `node:sqlite` prints an "experimental" warning; that is expected.

## What works today
Map (front/back, search by name/anatomical name/alias, list fallback, mouse-wheel zoom (anchored at the cursor), drag to pan, pinch zoom on touch screens, +/−/Reset buttons, keyboard, breadcrumbs, dark mode) · muscle detail with embedded
videos (youtube-nocookie, click-to-load), primary video, private notes · skipped list with manual assignment, re-check, title filter, manual URL import, aliases ·
sync (full/incremental/dry-run, lock, retries, history) · channel resolve/re-resolve/manual ID, API test, diagnostics ·
JSON/CSV export-import, DB backup/restore · offline mode (disable network sync).

## Google Cloud + API key (do this on your own computer)
UI wording changes over time; follow the current labels if they differ slightly.
1. Open https://console.cloud.google.com and sign in. 2. Project picker (top bar) → **New project** → name it `Elite Massage Muscle Map` → Create → select it.
3. Menu → **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.
4. **APIs & Services → Credentials → Create credentials → API key**. Leave the dialog open or use the copy button.
5. **Do not paste the key anywhere except your local file.** Copy `.env.example` to `.env.local` and put it after `YOUTUBE_API_KEY=` (no quotes/spaces). `.env.local` is git-ignored.
6. Restrict it: Credentials → click the key → **API restrictions → Restrict key → YouTube Data API v3 → Save**. Application restrictions: this is a server-side app on your computer, so "None" plus the API restriction is acceptable; an **IP address** restriction only works if your IP is stable.
7. Restart `npm start` (env files are read at startup). In **Admin → Synchronize**, click **Test API connection**, then **Re-resolve channel** (resolves `@EliteMassageBoulder` with `channels.list?forHandle`, verifies the title "Elite Massage and Injury Rehab", stores the channel ID and uploads playlist), then **Dry run**, then **Full sync**.
Never commit the key, prefix it with `NEXT_PUBLIC_`, or share screenshots showing it. The app never sends it to the browser (tested).
Troubleshooting: *API not enabled* → step 3; *invalid key* → re-copy; *403 / restrictions* → API restriction must include YouTube Data API v3; *quota exceeded* → default 10,000 units/day, this app uses ~1 unit per request (`playlistItems`, `videos`, `channels`), never `search.list`; *missing key / file not loaded* → file must be named `.env.local` in the project root, then restart; *channel not found* → enter the stable `UC…` ID in Admin → Settings.

## Online on GitHub Pages (phones included)
The site is published to **https://mg2.github.io/body-map/** by `.github/workflows/pages.yml`. The data lives in the repository (`state/db.json`).
- **Reading** is static. On every run the Action renders all API answers into files (`site/api/...`). No server is needed.
- **Admin changes** from the browser are committed as small files in `ops/`. The Action replays them against the same server code as `npm start`, commits `state/db.json`, and redeploys. Changes are live after about 1–2 minutes. The result of each change appears in a small box at the bottom right.
- **YouTube sync** runs in the Action every 6 hours (incremental), whenever you press a sync button in Admin, or manually via *Actions → Sync, apply admin changes & deploy → Run workflow*. The API key never leaves GitHub's secret store.
- **Login.** Static pages cannot read secrets, and writing to the repository needs a GitHub token. So the Action stores the token **encrypted** with your admin password (PBKDF2-SHA256, 600k iterations + AES-GCM) in `admin-key.json`. The password unlocks it in the browser, and with "Remember this device" the token stays in that browser. Use *Log out on this device* to forget it.

**Setup (once):**
1. Repository secrets (*Settings → Secrets and variables → Actions*): `YOUTUBE_API_KEY`, `ADMIN_PASSWORD` and **`ADMIN_TOKEN`**. For `ADMIN_TOKEN`, use a *fine-grained personal access token* (github.com → Settings → Developer settings → Fine-grained tokens): *Only select repositories → body-map*, permission **Contents: Read and write**, nothing else.
2. *Settings → Pages → Build and deployment → Source: **GitHub Actions*** (not "Deploy from a branch").
3. Push this project. The first run publishes the site.

**Security notes.** Everything in the repository and on the site is public on a free account, including private notes. Because `admin-key.json` is public, use a long password (4+ random words): the encryption is only as strong as the password. If a device is lost, revoke the token on GitHub, create a new one and update `ADMIN_TOKEN`. Changing `ADMIN_PASSWORD` alone does not log out devices that are already remembered.
**Moving local data:** `npm run state:from-db` copies `data/app.db` into `state/db.json`. `npm start` still runs the local version on its own `data/app.db`.

## Two channels: Muscle release and Yoga
The header switch **All | Muscle release | Yoga** (remembered in your browser) filters everything at once: which muscles light up on the map, the videos on a muscle's page, the counts, and "Recently added". In **All**, a muscle page groups its videos under “Muscle release” and “Yoga”. If a muscle has none in the current view but has some in the other, the page says so and offers “Show all videos”.
- **Channels.** The original muscle-release channel plus **@yogawithkassandra** (pre-configured; change, disable or re-resolve it in Admin → Settings & diagnostics → *Channel to configure*). *Sync now* reads both; the Channel dropdown next to the sync buttons limits it to one, and the CLI takes `--collection=yoga|release`. Each channel keeps its own stored channel ID and uploads playlist. A failure in one channel is reported (prefixed `[yoga]`) and never stops the other.
- **Upgrading.** An existing database is upgraded automatically (nothing is lost; old videos become “Muscle release”). The first sync then fetches the yoga channel (about 1,000 videos, roughly 45 API quota units). Older backups are upgraded when restored.
- **How yoga videos are matched** (title only, no approval step). Yoga titles name **body areas** (“Hips & Glutes”, “Neck & Shoulder”, “Lower Back”, “Core”), **poses** (“Pigeon Pose”, “Low Lunge”, “Puppy Pose”) and sometimes muscles (“Hamstrings”, “IT band”). A video appears on **every muscle of its area**, e.g. “Neck & Shoulder” → neck and shoulder muscles. More specific beats generic (“lower back” beats “back”, “hip flexor” beats “hip”). Look-alikes are ignored: “hands free”, “no props”, “(no planks, or downward dog)”, chakras, “yoga wheel”, “my dog”, Pilates names like “One Leg Circle”.
- **Full body.** Titles that say “full body”, “total body”, “whole body” or “entire body” (and routines that name six or more areas at once) are not tied to one area, so they get a target of their own: a **thick outline around the whole map with a small “Full body” tab**. Click the frame or the tab (or search “full body”) to open its page. The frame stays at the edges of the map when you zoom or pan, appears only when the current collection has full-body videos (like any muscle, unless “Show only muscles that have videos” is off), and is keyboard-accessible.
- **Still not on the map:** meditations, vlogs, Q&As and generic classes that name no body area (“Morning Yoga Flow”) are skipped (Admin → Skipped videos, with the reason). Checked against all 1,029 real titles: **379 (37%) map, 124 of them to Full body**; every skipped title that contains a body word is a deliberate exception (tests enforce this).
- **Tuning.** The rules are plain lists in `src/lib/yoga.ts` (`AREA_RULES`, `POSE_RULES`); a test checks every muscle name. Use `npm run match-report -- titles.txt` to see coverage and the skipped titles after a change; start-up re-checks auto-skipped videos once when rules change. The area/pose → muscle lists describe the *typical focus* of a class, not an exact or clinical claim.
- **Long skipped lists.** With hundreds of auto-skipped yoga videos, Admin → Skipped videos has a collection filter, title search and pages of 25, plus a bulk *Ignore forever* for the auto-skipped videos of one collection (never your own decisions). *Undo bulk ignore* under “Ignored forever” reverses exactly that.

## How videos get onto the map (muscle-release channel) (no approval step)
Sync (or a manual import) reads each **title** and does everything automatically:
1. **Is it a release video?** The title must contain one of the filter phrases (default: the word **release**, so "How to Release Your Traps", "Quad Release in 60 Seconds" and similar all count). Change the phrases in Admin → Settings → *Only index videos whose title contains…*.
2. **Which muscle?** The muscle name, anatomical name or alias in the title decides it ("traps", "hip flexors", "psoas", "calves"…). Several muscles in one title are all mapped (up to 6; longer lists look like full-body routines and are skipped).
3. Matching videos go straight to the map. The map shows **only muscles that have videos** (tick-box above the map to show all).
Everything else is stored but **skipped**: not a release title, no muscle recognised ("How to release tight shoulders" if shoulders isn't in the catalog), or too many muscles. Skipped videos are listed in **Admin → Skipped videos** with the reason, so nothing is silently lost. You can ignore that list entirely, assign a muscle by hand, add an alias and press **Re-check skipped videos**, or ignore a mapped video from its muscle page. Re-checking never touches videos you skipped yourself. Later syncs never change mappings or your choices.
Only the title is used (descriptions are not). The catalog has 81 entries (checked against the MuscleMap label list), including deeper and small muscles (piriformis, rotator cuff parts, psoas/iliacus via the hip-flexor group, scalenes, suboccipitals, facial and jaw muscles, hand muscles, diaphragm, intercostals and more) plus a few non-muscle regions (plantar fascia, Achilles/ankle, knee); deep muscles are drawn at an approximate surface position. A muscle that is still missing (e.g. iliocostalis) is skipped with its name in the reason; add it as an alias of an existing muscle in Admin → Aliases and press Re-check, or add a catalog entry plus a shape in `src/lib/catalog.ts` and `bodymap.ts`.

**Upgrading from an older build:** copy your old `data/` folder over. On start-up, if the built-in catalog changed, old "Needs a decision" videos are re-checked once automatically (their old description-based suggestions are dropped); videos you skipped or assigned yourself are never touched.

## Accent colour
The row of coloured dots in the header switches the accent between soft blue (default), green, red and yellow; the rainbow dot opens a colour picker for any custom colour. The choice is saved in your browser only. Buttons and outlines use a deeper shade so text stays readable (checked in light and dark mode), while the map uses a softer pastel fill. A custom colour is used as-is for both, so pick one that reads well on your theme.

## Undoing things
- **Assigned the wrong muscle?** On the muscle's page, **Remove from <muscle>** takes the video off just that muscle. If it was the last one, the video goes back to Admin → Skipped videos (shown as “Unassigned by you”, so rule changes never touch it). The removal is remembered, so syncs never re-add it.
- **Want the app to decide again?** **Reset to automatic** (on a muscle's video or on a Skipped card) discards all manual choices for that video and re-reads its title. Your private note is kept.
- **Ignore forever** (Skipped cards): the video leaves the Skipped list, is never re-checked by sync, Re-check or catalog upgrades. Find it under **Ignored forever** and press **Un-ignore** to send it back through the automatic flow.
- **Aliases you added** are listed under Admin → Aliases with a ✕. Built-in aliases can't be removed. Videos an alias already mapped keep their mapping; use Reset to automatic to re-evaluate them.

## Import / export / backup
CSV columns: `platform,url,title,description,publishedAt,muscleSlugs,notes` (platform must be `youtube`; slugs separated by `;`). Bad rows are reported with row numbers; good rows still import. Exports prefix cells starting with `= + - @` with `'` (spreadsheet formula protection; removed on re-import).
JSON import **merges**: new videos added; for videos you already have, only missing mappings are added. Your status, ignores, notes and approved/rejected mappings win. Backup = SQLite snapshot (`VACUUM INTO`); restore validates the file, makes a safety backup first, then replaces data.

## Security
Localhost-only (Host check, bind 127.0.0.1), POSTs need a custom header and same origin, strict CSP, embeds limited to youtube-nocookie, thumbnails limited to ytimg.com, all external text rendered via `textContent`. The admin API has **no authentication**: add it before exposing the app beyond your machine.

## Limitations (honest list)
Map artwork is body-muscles (Apache-2.0) and is stylised, not clinical; deep and small muscles (piriformis, facial, rotator cuff parts…) are schematic shapes at approximate positions on top of it; children are drawn over their group, so use the list/search to reach a group. Muscle descriptions are short and general (location and main action); no creator phrase-rule table or UI to add muscles/SVG shapes yet. Scrolling the mouse wheel over the map zooms it instead of scrolling the page; move the pointer off the map to scroll the page. Videos play in a large pop-up (click the thumbnail; Esc, ✕ or a click outside closes it). Short detection is a duration guess (≤180 s). The live YouTube API has not been exercised by the author (tests use mocks). Uses `node:sqlite` and plain JS instead of Next.js/Prisma/Tailwind/Zod because the build environment could not install packages; see ARCHITECTURE.md.
Copyright: videos are only linked/embedded via official YouTube players; creator attribution is always shown; nothing is downloaded or re-hosted.
