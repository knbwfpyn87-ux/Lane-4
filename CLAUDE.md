# Lane 4

Lane 4 is a track and field web app hosted on GitHub Pages.

## Rules

- **Never edit, overwrite, or delete `firebase-config.js`.** It holds the live Firebase keys.
- **Never loosen `firestore.rules`.** Changes may only keep or tighten access. One approved exception: coaches of admin-approved teams can write Rankings (`board`) for athletes on their own roster who said yes. Don't widen it further.
- **Never put passwords or secrets in any file.** This repo is public.
- **Data is saved under the permanent key `"lane4-data"`.** Never rename it; add migrations instead.
- **AI only makes small, capped tweaks to premade workouts, and only on a free service** (Cloudflare Workers AI's free allowance). No paid AI APIs, no AI-written workouts or plans, no other AI coaching. The app's code must cap every AI change (`clampAdj()` in `index.html`, and again in the Worker). The AI may only fit a workout to the athlete's events, sore spots, and part of the season: it gets nothing else (no name, log, notes, or times), never writes text shown to users, and sore spots may only make a workout easier. AI tweaks are on (`AI_TWEAKS=true`) but only run once `LANE4_WORKER` is set; otherwise the planner uses fixed rules. Reading text from results screenshots (Tesseract.js, on the device, free) is allowed: it isn't coaching, and athletes check every result before it's saved.
- **Test changes before committing, and show the diff before pushing.**
