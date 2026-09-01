-- Study Command Centre V1
-- Safe to run in the existing Supabase project. All tables use the scc_ prefix.

create table if not exists public.scc_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_minutes integer not null default 240,
  minimum_goal integer not null default 3,
  pomodoro_focus integer not null default 25,
  pomodoro_break integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scc_exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  short_name text not null,
  deadline date,
  color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.scc_microtopics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_id uuid not null references public.scc_exams(id) on delete cascade,
  subject text not null,
  topic text not null,
  microtopic text not null,
  status text not null default 'not_started',
  strength text not null default 'new',
  priority integer not null default 3,
  estimated_minutes integer not null default 30,
  last_studied_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.scc_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  microtopic_id uuid references public.scc_microtopics(id) on delete set null,
  exam_id uuid references public.scc_exams(id) on delete set null,
  title text not null,
  subject text,
  topic text,
  task_type text not null default 'study',
  scheduled_date date not null default current_date,
  estimated_minutes integer not null default 30,
  priority integer not null default 3,
  source text not null default 'planner',
  completed boolean not null default false,
  completed_at timestamptz,
  actual_minutes integer not null default 0,
  xp_awarded integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scc_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  microtopic_id uuid references public.scc_microtopics(id) on delete cascade,
  task_id uuid references public.scc_tasks(id) on delete set null,
  title text not null,
  subject text,
  exam text,
  stage integer not null default 0,
  due_date date not null,
  completed boolean not null default false,
  rating text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.scc_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exam text not null,
  subject text not null,
  topic text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.scc_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.scc_tasks(id) on delete set null,
  mode text not null default 'countdown',
  minutes integer not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.scc_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp integer not null default 0,
  streak integer not null default 0,
  longest_streak integer not null default 0,
  last_goal_date date,
  updated_at timestamptz not null default now()
);

alter table public.scc_settings enable row level security;
alter table public.scc_exams enable row level security;
alter table public.scc_microtopics enable row level security;
alter table public.scc_tasks enable row level security;
alter table public.scc_reviews enable row level security;
alter table public.scc_errors enable row level security;
alter table public.scc_sessions enable row level security;
alter table public.scc_stats enable row level security;

create policy "scc_settings_own" on public.scc_settings for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "scc_exams_own" on public.scc_exams for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "scc_microtopics_own" on public.scc_microtopics for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "scc_tasks_own" on public.scc_tasks for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "scc_reviews_own" on public.scc_reviews for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "scc_errors_own" on public.scc_errors for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "scc_sessions_own" on public.scc_sessions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "scc_stats_own" on public.scc_stats for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- V2 syllabus metadata (safe to run after V1)
alter table public.scc_microtopics add column if not exists source_key text;
alter table public.scc_microtopics add column if not exists source_name text;
alter table public.scc_microtopics add column if not exists source_order integer;
alter table public.scc_microtopics add column if not exists paper text;
alter table public.scc_microtopics add column if not exists concept_key text;
alter table public.scc_microtopics add column if not exists is_leaf boolean not null default true;
alter table public.scc_microtopics add column if not exists counts_toward_completion boolean not null default true;
alter table public.scc_microtopics add column if not exists recurring boolean not null default false;
create index if not exists scc_microtopics_user_exam_status_idx on public.scc_microtopics(user_id, exam_id, status);
create index if not exists scc_microtopics_user_source_order_idx on public.scc_microtopics(user_id, exam_id, source_order);
create unique index if not exists scc_microtopics_user_source_key_uidx on public.scc_microtopics(user_id, source_key);
