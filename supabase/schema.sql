-- Run once in the Supabase SQL editor.
-- Phase 5 only: the app runs fine without this table.

create extension if not exists "pgcrypto";

create table if not exists public.trips (
  id               uuid primary key default gen_random_uuid(),
  cache_key        text not null,
  answers          jsonb not null,
  itinerary        jsonb not null,
  destination_name text not null,
  created_at       timestamptz not null default now()
);

-- Cache lookups are always "newest row for this key".
create index if not exists trips_cache_key_created_idx
  on public.trips (cache_key, created_at desc);

-- Trips are readable by anyone holding the share link (the uuid is the secret),
-- but only the server's service-role key may write.
alter table public.trips enable row level security;

drop policy if exists "trips are publicly readable" on public.trips;
create policy "trips are publicly readable"
  on public.trips for select
  using (true);
