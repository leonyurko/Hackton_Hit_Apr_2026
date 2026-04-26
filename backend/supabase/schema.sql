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
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = id);

-- mood_logs
drop policy if exists "own mood logs" on public.mood_logs;
create policy "own mood logs" on public.mood_logs for all using (auth.uid() = user_id);

-- crisis_alerts (only admins/server can see — service role bypasses RLS)
drop policy if exists "no direct access" on public.crisis_alerts;
create policy "no direct access" on public.crisis_alerts for all using (false);

-- coping_sessions
drop policy if exists "own coping" on public.coping_sessions;
create policy "own coping" on public.coping_sessions for all using (auth.uid() = user_id);

-- wearable_snapshots
drop policy if exists "own wearable" on public.wearable_snapshots;
create policy "own wearable" on public.wearable_snapshots for all using (auth.uid() = user_id);

-- workout_plans
drop policy if exists "own workouts" on public.workout_plans;
create policy "own workouts" on public.workout_plans for all using (auth.uid() = user_id);

-- pain_logs
drop policy if exists "own pain logs" on public.pain_logs;
create policy "own pain logs" on public.pain_logs for all using (auth.uid() = user_id);

-- workout_logs
drop policy if exists "own workout logs" on public.workout_logs;
create policy "own workout logs" on public.workout_logs for all using (auth.uid() = user_id);

-- pt_reports: soldier sees own reports, PT sees reports assigned to them
drop policy if exists "soldier or pt" on public.pt_reports;
create policy "soldier or pt" on public.pt_reports for all
  using (auth.uid() = user_id or auth.uid() = pt_user_id);

-- peer_groups: any authenticated user can read
drop policy if exists "read peer groups" on public.peer_groups;
create policy "read peer groups" on public.peer_groups for select using (auth.role() = 'authenticated');

-- peer_group_members: members of a group can see the group roster
drop policy if exists "own membership" on public.peer_group_members;
create policy "own membership" on public.peer_group_members for all using (auth.uid() = user_id);

-- buddy_matches
drop policy if exists "own buddy" on public.buddy_matches;
create policy "own buddy" on public.buddy_matches for all
  using (auth.uid() = soldier_id or auth.uid() = mentor_id);

-- chat_messages: room participants can read/write
drop policy if exists "chat access" on public.chat_messages;
create policy "chat access" on public.chat_messages for all using (auth.uid() = sender_id);

-- benefits_conversations
drop policy if exists "own benefits chat" on public.benefits_conversations;
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

drop policy if exists "own reminders" on public.reminders;
create policy "own reminders" on public.reminders
  for all using (auth.uid() = user_id);

-- push_subscriptions: server only (service role bypasses RLS); users can register their own
drop policy if exists "own push sub" on public.push_subscriptions;
create policy "own push sub" on public.push_subscriptions
  for all using (auth.uid() = user_id);

-- =============================================================================
-- RAG (Retrieval-Augmented Generation) Tables
-- =============================================================================

-- Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- knowledge_base (for clinical guidelines, coping strategies, articles)
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_base (
  id          uuid primary key default uuid_generate_v4(),
  content     text not null,
  metadata    jsonb default '{}', -- store title, source, etc.
  embedding   vector(2048),       -- OpenRouter Nemotron-Embed VL (2048)
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- user_memory (for personalized RAG based on user history)
-- ---------------------------------------------------------------------------
create table if not exists public.user_memory (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  content     text not null,      -- e.g., summary of a mood log or chat
  metadata    jsonb default '{}', -- store type (mood, chat, session) and original IDs
  embedding   vector(2048),       -- OpenRouter Nemotron-Embed VL (2048)
  created_at  timestamptz default now()
);

-- RLS for RAG tables
alter table public.knowledge_base enable row level security;
alter table public.user_memory    enable row level security;

-- knowledge_base: all authenticated users can read (or public, depending on your auth setup)
drop policy if exists "read knowledge base" on public.knowledge_base;
create policy "read knowledge base" on public.knowledge_base 
  for select using (auth.role() = 'authenticated');

-- user_memory: users can only access their own memory
drop policy if exists "own memory" on public.user_memory;
create policy "own memory" on public.user_memory 
  for all using (auth.uid() = user_id);

-- Optional: Create HNSW indexes for faster similarity search (useful even in MVP if it grows)
-- NOTE: pgvector HNSW indexes only support up to 2000 dimensions. Since we are using 2048 dimensions, 
-- we will rely on exact nearest neighbor search (sequential scan), which is perfectly fine for MVP scale.
-- create index if not exists knowledge_base_embedding_idx on public.knowledge_base using hnsw (embedding vector_cosine_ops);
-- create index if not exists user_memory_embedding_idx on public.user_memory using hnsw (embedding vector_cosine_ops);

-- =============================================================================
-- RAG Match Functions
-- =============================================================================

-- 1. Match function for knowledge_base
create or replace function match_knowledge_base(
  query_embedding vector(2048),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql
as $$
  select
    kb.id,
    kb.content,
    kb.metadata,
    1 - (kb.embedding <=> query_embedding) as similarity
  from public.knowledge_base kb
  where 1 - (kb.embedding <=> query_embedding) > match_threshold
  order by kb.embedding <=> query_embedding
  limit match_count;
$$;

-- 2. Match function for user_memory
create or replace function match_user_memory(
  query_embedding vector(2048),
  target_user_id uuid,
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql
as $$
  select
    um.id,
    um.content,
    um.metadata,
    1 - (um.embedding <=> query_embedding) as similarity
  from public.user_memory um
  where um.user_id = target_user_id
    and 1 - (um.embedding <=> query_embedding) > match_threshold
  order by um.embedding <=> query_embedding
  limit match_count;
$$;
