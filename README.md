# Lane 4 website: your own URL, real accounts, no Claude needed

What's in this folder
- index.html: the whole app
- lane4-firebase.js: accounts (email + password + email verification), cloud save, Rankings
- firebase-config.js: where you paste your Firebase keys (step 2)
- firestore.rules: the security rules that protect everyone's data (step 4)
- firebase.json: hosting settings for Firebase

Without step 2 the site still works, saving on each person's device only.

## 1. Create a Firebase project (free)
1. Go to console.firebase.google.com, sign in with a Google account, click "Create a project", name it lane4.
   You can turn Google Analytics off.
2. Stay on the free Spark plan. No credit card needed.

## 2. Add a web app and paste the keys
1. In the project: click the </> (Web) icon, name it "Lane 4 web". Skip "Firebase Hosting" for now.
2. Firebase shows a firebaseConfig block. Copy the six values into firebase-config.js, replacing every PASTE_HERE.
   These keys are meant to be public. The security rules are what protect data.

## 3. Turn on sign-in (Google + email)
1. Build → Authentication → Get started → Sign-in method.
2. Google → Enable → pick your support email → Save. (Uses each person's Google account; Lane 4 never sees their password.)
3. Email/Password → Enable → Save. (Backup option for people without Google.)
4. Authentication → Settings → User account management: keep "Email enumeration protection" ON,
   and set "Link accounts that use the same email" so one person can't end up with two accounts.
2. (Optional) Authentication → Templates → Email address verification: change the sender name to "Lane 4".

## 4. Turn on the database and paste the rules
1. Build → Firestore Database → Create database → Production mode → pick a US location (like nam5).
2. Firestore → Rules tab: delete everything, paste all of firestore.rules, click Publish.

## 5. Put the site online (pick one)
Option A, easiest: Netlify
1. Go to app.netlify.com/drop and drag the whole lane4-web folder onto the page.
2. Site settings → Change site name → lane4-track. Your URL: https://lane4-track.netlify.app
3. Back in Firebase: Authentication → Settings → Authorized domains → Add domain → lane4-track.netlify.app

Google sign-in tip: on iPhone Safari, Google sign-in is most reliable when the site runs on Firebase Hosting
(Option B), because the sign-in page and your site share a domain. Netlify works too, but if Google sign-in
fails on iPhone, switch to Option B.

Option B: Firebase Hosting (needs Node.js on a computer; recommended for Google sign-in)
1. Install Node.js, then in a terminal: npm install -g firebase-tools
2. In this folder: firebase login, then firebase init (choose Hosting and Firestore, use existing project,
   public directory ".", single-page app: No, don't overwrite index.html or firestore.rules)
3. firebase deploy. Your URL: https://YOUR-PROJECT.web.app (custom domains: Hosting → Add custom domain)

## 6. Make yourself the admin
1. Open your site and create your account, then verify your email.
2. Firebase → Authentication → Users: copy your User UID.
3. Firestore → Start collection → Collection ID: admins → Document ID: paste your UID →
   add any field (like name = Xavier) → Save.
4. Reload the site. Settings now shows "Admin: verify times."
   To add a co-admin, add their UID the same way. Nobody can make themselves an admin from the app.

## Admin panel (admin.html)
Your separate admin page lives at https://knbwfpyn87-ux.github.io/Lane-4/admin.html
- Sign in with Google, or with an email + password account you create in Firebase → Authentication → Users → Add user.
- The page only works for accounts in the Firestore "admins" collection (step 6). Anyone else sees "Not an admin."
- Never put a password in any file in this repo: the repo is public.

## 7. Before you share it widely
- Write a short privacy policy page: what you store (email, PRs, profile, optional photo), that photos and
  workouts are never public, and how to delete an account (Settings → Account → Delete my account).
- Sign-up requires users to confirm they're 13 or older.
- College standards come from Preferred Recruit (trackandfieldstandards.com). Keep the credit, and don't launch
  publicly with their numbers until they reply to your request.

## Privacy built in
- Emails are never shown anywhere in the app, not even to admins. The account box only says "Signed in with Google" or "with email."
- Rankings show only the name each athlete types in, plus school and class year.
- Photos, workouts, goals, and contact info are never public.
- Strava tokens and race-day push reminders live only in your own Cloudflare Worker's database (see below).

## Strava sync, push reminders, and AI workout tweaks (optional)
Set up the free Cloudflare Worker in `worker/` by following `worker/README.md`. Until then, the Strava box
stays hidden, race-day reminders work only while Lane 4 is open or through "Add my plan to my calendar,"
and the workout planner adjusts workouts with its own fixed rules instead of AI.

## What each person can do (enforced by firestore.rules, not just hidden buttons)
- Read and write only their own saved data.
- Submit only their own times, and only as "pending." They can't approve themselves.
- See Rankings once signed in and verified.
- Admins approve, reject, or remove times. Admin status lives only in the Firebase console.

## Costs
Free on the Spark plan for a project this size (thousands of users). Netlify's free plan is also enough.
A custom domain like lane4.app is about $10–20/year if you want one.
