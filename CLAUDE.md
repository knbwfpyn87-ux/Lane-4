# Lane 4

Lane 4 is a track and field web app hosted on GitHub Pages.

## Rules

- **Never edit, overwrite, or delete `firebase-config.js`.** It holds the live Firebase keys.
- **Never loosen `firestore.rules`.** Changes may only keep or tighten access.
- **Never put passwords or secrets in any file.** This repo is public.
- **Data is saved under the permanent key `"lane4-data"`.** Never rename it; add migrations instead.
- **AI only makes small, capped tweaks to premade workouts, and only on a free service** (Cloudflare Workers AI's free allowance). No paid AI APIs, no AI-written workouts or plans, no other AI coaching. The app's code must cap every AI change (`clampAdj()` in `index.html`, and again in the Worker). AI tweaks are currently off (`AI_TWEAKS=false` in `index.html`); the planner uses fixed rules only.
- **Test changes before committing, and show the diff before pushing.**
