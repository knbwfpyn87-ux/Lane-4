# Lane 4 Worker: Strava sync and race-day push reminders

Lane 4 runs on GitHub Pages, which can't keep secrets or send notifications on a schedule.
This small Cloudflare Worker does both. It's free on Cloudflare's free plan.

What it does
- Strava: handles the "Connect with Strava" sign-in, keeps the Strava tokens, and hands Lane 4 your activities.
  Lane 4 itself only keeps a random session id, never a Strava token.
- Reminders: stores each step time of your race-day plan and sends a push notification when it's due,
  even when Lane 4 is closed. Each reminder is deleted as soon as it's sent.
- Workout tweaks: "Adjust for me" in the workout planner asks a small AI model (Cloudflare Workers AI, free
  daily allowance) to nudge a premade workout based on your recent log. Changes are capped at 1 rep per set,
  3% effort, and 30s rest. Past the free daily limit, requests simply fail and Lane 4 falls back to its own rules.
  Nothing is billed on the free plan. This is turned off in the app for now (`AI_TWEAKS=false` in index.html),
  so the planner uses Lane 4's fixed rules even with the Worker set up.

Without this Worker, Lane 4 still works: the Strava box stays hidden, and reminders pop up only while
Lane 4 is open (or through "Add my plan to my calendar").

Never paste the Strava Client Secret into any file in this repo. It goes only into Cloudflare (step 4).

## 1. Create a Cloudflare account and database
1. Sign up at dash.cloudflare.com (free plan, no card needed).
2. Left menu → Storage & Databases → D1 SQL Database → Create → name it `lane4` → Create.

## 2. Create the Worker
1. Left menu → Workers & Pages → Create → Create Worker → name it `lane4` → Deploy.
2. Click "Edit code", delete everything in the editor, paste all of `worker/lane4-worker.js`, click Deploy.
3. Note your Worker's address, like `https://lane4.YOURNAME.workers.dev`. Opening it should say "Lane 4 Worker is running."

## 3. Create the Strava API app
1. Go to strava.com/settings/api (sign in to Strava first).
2. Fill in: Application Name `Lane 4`, Category `Training`, Website `https://knbwfpyn87-ux.github.io/Lane-4/`,
   Authorization Callback Domain: your Worker's host only, like `lane4.YOURNAME.workers.dev` (no https://, no slash).
3. Upload the Lane 4 icon if it asks, then Create. Keep this page open: you need the Client ID and Client Secret.
4. Heads-up: new Strava apps can connect only one athlete (you) until Strava approves more. When you're ready
   for other athletes, use the "athlete capacity" request form linked from Strava's developer pages.

## 4. Settings on the Worker
In Workers & Pages → lane4 → Settings:
1. Bindings → Add → D1 database → Variable name `DB` → database `lane4` → Save.
   Then Bindings → Add → Workers AI → Variable name `AI` → Save.
2. Variables and Secrets → Add each:
   - `APP_URL` (Text): `https://knbwfpyn87-ux.github.io/Lane-4/`
   - `STRAVA_CLIENT_ID` (Text): the Client ID from Strava
   - `STRAVA_CLIENT_SECRET` (Secret): the Client Secret from Strava
   - `CONTACT_EMAIL` (Text, optional): an email push services can contact about notification problems
3. Trigger Events → Add → Cron Triggers → `* * * * *` (every minute) → Add. This is what sends reminders on time.

## 5. Point Lane 4 at the Worker
In `index.html`, find `const LANE4_WORKER="";` near the top of the script and put your Worker's address
between the quotes, like `const LANE4_WORKER="https://lane4.YOURNAME.workers.dev";` (no slash at the end).
That address isn't a secret. Commit and push, then:
- Log tab → Strava → Connect with Strava.
- Race day tab → build a plan → turn on "Remind me at each step" and allow notifications.
  On iPhone, push notifications only work after you add Lane 4 to your Home Screen
  (Safari → Share → Add to Home Screen) and open it from there (iOS 16.4 or later).

## What's stored, and where
- In your Cloudflare D1 database: Strava tokens for each connected athlete (deleted when they tap Disconnect),
  each phone's push address and the step times of its plan (deleted once sent), and the Worker's own
  notification signing key (made automatically the first time).
- Nothing from Strava is shared publicly or with other athletes. Lane 4 only reads activities; it never posts to Strava.
- Workout tweaks send the workout plus a short summary of the athlete's last few log entries (no name or email)
  to Cloudflare Workers AI. The Worker doesn't store them.

## Costs and limits
Cloudflare's free plan covers 100,000 Worker requests a day, the every-minute cron trigger, and 10,000 Workers AI
"neurons" a day (roughly 200 workout tweaks). Past that, AI requests fail until midnight UTC; you're never charged
unless you upgrade to the paid plan yourself.
Strava's default API limit is 200 requests every 15 minutes and 2,000 a day, shared by everyone using your app.
