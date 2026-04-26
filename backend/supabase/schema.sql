-- =============================================================================
-- Eitan App — Supabase Database Schema
-- Run this in the Supabase SQL Editor (Database > SQL Editor > New Query)
-- =============================================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- profiles (extends auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null,
  role            text not null default 'soldier' check (role in ('soldier', 'pt', 'mentor', 'admin')),
  injury_type     text,
  mobility_level  int check (mobility_level between 1 and 5),
  region          text,
  interests       text[] default '{}',
  career_goal     text,
  language        text not null default 'he' check (language in ('he', 'en')),
  onboarded_at    timestamptz,
  created_at      timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- mood_logs
-- ---------------------------------------------------------------------------
create table if not exists public.mood_logs (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  text_input        text,
  sentiment         text check (sentiment in ('anxious', 'low', 'agitated', 'exhausted', 'stable')),
  ai_recommendation jsonb,
  created_at        timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- crisis_alerts
-- ---------------------------------------------------------------------------
create table if not exists public.crisis_alerts (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  mood_log_id uuid references public.mood_logs(id),
  resolved    boolean default false,
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- coping_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.coping_sessions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text check (type in ('breathing', 'grounding', 'journaling', 'relaxation', 'movement')),
  prompt      text,
  completed   boolean default false,
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- wearable_snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.wearable_snapshots (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  source        text check (source in ('apple_health', 'garmin', 'fitbit', 'samsung', 'manual')),
  resting_hr    int,
  hrv           float,
  sleep_hours   float,
  sleep_quality text check (sleep_quality in ('poor', 'fair', 'good', 'excellent')),
  steps         int,
  spo2          float,
  recorded_at   timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- workout_plans
-- ---------------------------------------------------------------------------
create table if not exists public.workout_plans (
  id                        uuid primary key default uuid_generate_v4(),
  user_id                   uuid not null references public.profiles(id) on delete cascade,
  plan                      jsonb not null,
  generated_for             date not null,
  pain_level_at_generation  int,
  ai_notes                  text,
  created_at                timestamptz default now(),
  unique (user_id, generated_for)
);

-- ---------------------------------------------------------------------------
-- pain_logs
-- ---------------------------------------------------------------------------
create table if not exists public.pain_logs (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  pain_level  int not null check (pain_level between 1 and 10),
  location    text,
  notes       text,
  logged_at   timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- workout_logs (completion records)
-- ---------------------------------------------------------------------------
create table if not exists public.workout_logs (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  plan_id       uuid references public.workout_plans(id),
  pain_after    int check (pain_after between 1 and 10),
  energy_after  int check (energy_after between 1 and 5),
  notes         text,
  created_at    timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- pt_reports
-- ---------------------------------------------------------------------------
create table if not exists public.pt_reports (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  pt_user_id   uuid references public.profiles(id),
  report_data  jsonb,
  summary      text,
  period_start date,
  period_end   date,
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- peer_groups
-- ---------------------------------------------------------------------------
create table if not exists public.peer_groups (
  id         uuid primary key default uuid_generate_v4(),
  topic      text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- peer_group_members
-- ---------------------------------------------------------------------------
create table if not exists public.peer_group_members (
  group_id         uuid not null references public.peer_groups(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  anonymous_alias  text,
  joined_at        timestamptz default now(),
  primary key (group_id, user_id)
);

-- ---------------------------------------------------------------------------
-- buddy_matches
-- ---------------------------------------------------------------------------
create table if not exists public.buddy_matches (
  id          uuid primary key default uuid_generate_v4(),
  soldier_id  uuid not null references public.profiles(id) on delete cascade,
  mentor_id   uuid not null references public.profiles(id) on delete cascade,
  match_score float,
  status      text default 'active' check (status in ('pending', 'active', 'ended')),
  matched_at  timestamptz default now(),
  unique (soldier_id)
);

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id           uuid primary key default uuid_generate_v4(),
  room_id      uuid not null,
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  content      text not null,
  is_anonymous boolean default true,
  sent_at      timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- benefits_conversations
-- ---------------------------------------------------------------------------
create table if not exists public.benefits_conversations (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  messages   jsonb default '[]',
  updated_at timestamptz default now(),
  unique (user_id)
);

-- =============================================================================
-- Row Level Security (RLS)
-- Enable RLS and add policies so users can only access their own data.
-- =============================================================================

alter table public.profiles               enable row level security;
alter table public.mood_logs              enable row level security;
alter table public.crisis_alerts          enable row level security;
alter table public.coping_sessions        enable row level security;
alter table public.wearable_snapshots     enable row level security;
alter table public.workout_plans          enable row level security;
alter table public.pain_logs              enable row level security;
alter table public.workout_logs           enable row level security;
alter table public.pt_reports             enable row level security;
alter table public.peer_groups            enable row level security;
alter table public.peer_group_members     enable row level security;
alter table public.buddy_matches          enable row level security;
alter table public.chat_messages          enable row level security;
alter table public.benefits_conversations enable row level security;

-- profiles: users see only their own
create policy "own profile" on public.profiles for all using (auth.uid() = id);

-- mood_logs
create policy "own mood logs" on public.mood_logs for all using (auth.uid() = user_id);

-- crisis_alerts (only admins/server can see — service role bypasses RLS)
create policy "no direct access" on public.crisis_alerts for all using (false);

-- coping_sessions
create policy "own coping" on public.coping_sessions for all using (auth.uid() = user_id);

-- wearable_snapshots
create policy "own wearable" on public.wearable_snapshots for all using (auth.uid() = user_id);

-- workout_plans
create policy "own workouts" on public.workout_plans for all using (auth.uid() = user_id);

-- pain_logs
create policy "own pain logs" on public.pain_logs for all using (auth.uid() = user_id);

-- workout_logs
create policy "own workout logs" on public.workout_logs for all using (auth.uid() = user_id);

-- pt_reports: soldier sees own reports, PT sees reports assigned to them
create policy "soldier or pt" on public.pt_reports for all
  using (auth.uid() = user_id or auth.uid() = pt_user_id);

-- peer_groups: any authenticated user can read
create policy "read peer groups" on public.peer_groups for select using (auth.role() = 'authenticated');

-- peer_group_members: members of a group can see the group roster
create policy "own membership" on public.peer_group_members for all using (auth.uid() = user_id);

-- buddy_matches
create policy "own buddy" on public.buddy_matches for all
  using (auth.uid() = soldier_id or auth.uid() = mentor_id);

-- chat_messages: room participants can read/write
create policy "chat access" on public.chat_messages for all using (auth.uid() = sender_id);

-- benefits_conversations
create policy "own benefits chat" on public.benefits_conversations for all using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- reminders
-- ---------------------------------------------------------------------------
create table if not exists public.reminders (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  title            text not null,
  type             text default 'custom' check (type in ('prescription', 'appointment', 'break', 'exercise', 'hydration', 'therapy', 'custom')),
  description      text,
  -- For 'once' reminders: exact fire time
  scheduled_at     timestamptz,
  -- For recurring reminders
  recurrence       text not null default 'once' check (recurrence in ('once', 'daily', 'weekly', 'weekdays')),
  recurrence_time  time,           -- HH:MM (stored as time type)
  recurrence_days  int[],          -- [0-6] for 'weekly' (0=Sun)
  is_active        boolean default true,
  last_sent_at     timestamptz,
  created_at       timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- push_subscriptions (stores browser PushSubscription objects)
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  subscription jsonb not null,
  updated_at   timestamptz default now(),
  unique (user_id)
);

-- RLS for reminders
alter table public.reminders          enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "own reminders" on public.reminders
  for all using (auth.uid() = user_id);

-- push_subscriptions: server only (service role bypasses RLS); users can register their own
create policy "own push sub" on public.push_subscriptions
  for all using (auth.uid() = user_id);
