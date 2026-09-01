# Study Command Centre V4

V4 makes the daily planner date-aware for the Kerala PSC 40-day revision schedule (1 Sep–10 Oct 2026). It keeps the full V3 syllabus bank and tracking system, but PSC topics are now chosen from the day-specific revision-plan focus rather than from the beginning of the syllabus. Weekly revision Sundays and the two grand-revision/mock days get dedicated planner tasks. Due recall time and manual tasks consume daily capacity. Current Affairs and the daily PSC MCQ block are automatically included when time permits.

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

## V2 syllabus engine
V2 includes `syllabus-data.js`, a source-derived micro-topic bank for Kerala PSC University Assistant, UPSC GS, and Public Administration Optional. On authenticated startup the app imports missing syllabus rows into the existing `scc_microtopics` table in batches. Reopening is idempotent because rows are keyed by `source_key`.

The Progress screen excludes recurring Current Affairs from the finite PSC denominator. The selected PSC regional-language bank is Malayalam; Kannada and Tamil are alternative exam-language options and are not included in the user's completion denominator.


## V5 hierarchy cleanup
- Structural/umbrella syllabus rows can now be marked `is_leaf: false` and are excluded from daily study planning.
- The Public Administration umbrella row `Introduction to administration and Public Administration` is now structural; its granular child concepts remain in the syllabus bank and are scheduled individually.
- Structural rows do not count toward completion totals, so progress reflects genuine study items only.

## V6 PSC Sprint Mode
- Through 14 Oct 2026, the planner protects about 80% of free study capacity for PSC after manual tasks and due recall.
- PSC due reviews are reserved before new Pub Ad/UPSC work.
- Unfinished PSC items from earlier 40-day-plan dates remain first priority; they do not disappear when the date changes.
- Once backlog/current-day PSC is covered, the planner pulls future PSC schedule items forward to create revision runway.
- PSC items not explicitly mapped in the 40-day revision PDF are still retained and scheduled after mapped items, preventing silent syllabus omissions.
- Pub Ad is capped to a small remainder and UPSC GS can receive zero time on PSC-heavy days.
- Weekly revision and grand-revision days remain revision/mock focused.

## Consolidated PSC Sprint planner
This build freezes the planner rules through 14 October 2026. Daily capacity is a hard ceiling. Manual work and due recall consume capacity first; PSC scheduled/backlogged coverage, required practice/current affairs, and extra PSC coverage are prioritized before the controlled Public Administration/UPSC remainder. Generated overdue rows are rebuilt rather than duplicated. See `ACCEPTANCE_TESTS.md` for the packaged checks.

### Focus time tracking
The timer now records real elapsed focus time when you pause or when the countdown finishes. Today's total is shown in the header and inside the Focus Timer. Each task separately shows planned time and actual studied time. Timer completion has an audible cue and a blocking in-app Time's up dialog so a finished session is obvious.
