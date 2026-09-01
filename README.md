# Study Command Centre V1

A strict, micro-topic-first study planner built around your requested workflow.

## Included
- Today dashboard with ordered individual tasks
- 4-hour default day, changeable to minimum/push day
- Manual tasks with exam, subject, topic, timer, priority and date
- Carry-over that redistributes missed tasks without endlessly overloading tomorrow
- Countdown, Pomodoro and 10-minute recall timer modes
- Automatic spaced-repetition queue: 1, 3, 7, 14, 30 days, adjusted by Weak/Shaky/Strong rating
- Error Directory with only Exam, Subject and Topic
- XP based on task completion, focus time and reviews
- Streak based on minimum goal, default 3 tasks
- Progress screen with remaining micro-topics/tasks per exam
- Supabase login/sync plus offline fallback
- PWA manifest for install-like browser use

## Supabase setup
The app points to your existing Supabase project using its publishable client key. This is safe for browser use when RLS is enabled.

1. In Supabase Dashboard, open SQL Editor.
2. Run `schema.sql` once.
3. Open `index.html` through a local server or deploy the folder to GitHub Pages / Netlify / Vercel.
4. Create an account or sign in. The starter plan is inserted automatically the first time.

The database tables use the prefix `scc_`, so they do not overwrite the existing Daily Quest tables.

## Important V1 limitation
The full Kerala PSC + UPSC GS + Public Administration micro-topic bank is not yet imported. The engine is ready for it, and the next build step is to generate/import the complete structured syllabus dataset so the Progress screen shows true micro-topic counts rather than task counts.
