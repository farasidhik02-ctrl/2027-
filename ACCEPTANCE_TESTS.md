# Consolidated planner acceptance checks

This build freezes the PSC sprint planner through 14 October 2026.

Checked before packaging:
- JavaScript syntax passes (`node --check`).
- Local calendar date is used (not UTC date slicing).
- New planner engine auto-rebuilds unfinished generated work once; manual/completed work is preserved.
- Replan deletes only unfinished generated work for today and stale generated carry-over.
- Overdue generated tasks do not duplicate; unfinished microtopics return to the eligible pool.
- Manual tasks consume daily capacity and are never deleted by Replan.
- Due reviews consume 10 minutes each in capacity and appear before new study in Today's Plan.
- PSC due reviews are ordered before other reviews.
- PSC scheduled/backlogged microtopics come before practice/current affairs.
- 50 PSC MCQs and Current Affairs are reserved before extra PSC coverage, so they cannot be crowded out.
- Extra PSC coverage is pulled forward only after required PSC work.
- Pub Ad gets at most 40 minutes during the PSC sprint.
- UPSC GS gets at most 20 minutes during the sprint and zero when no genuine capacity remains.
- Planner never inserts a task if it would exceed the selected capacity.
- Only leaf, completion-counting, non-recurring, not-studied/not-mastered microtopics are eligible as new study.
- Completing a study microtopic marks it Studied and creates its first spaced review.
- MCQ/current-affairs/manual tasks do not create fake topic reviews.
- Reviews continue through adaptive 1/3/7/14/30-day stages and Strong final review can mark Mastered.
- 3h / 4h / 6h capacity values remain supported.

## Focus timer persistence (added after real-use test)
- [x] Timer uses wall-clock elapsed time rather than trusting 1-second interval ticks.
- [x] Pausing saves elapsed focus time to scc_sessions and task.actual_minutes.
- [x] Completed timer saves elapsed focus time before signalling completion.
- [x] Task cards display planned minutes and actual studied minutes separately.
- [x] Header and Focus Timer show total minutes studied today.
- [x] Timer completion triggers an in-app Time's up dialog, audible three-tone signal, title alert, and status text.
- [x] Reset keeps already-saved focus time.
