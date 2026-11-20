-- Buck Forecast: database setup as applied to Supabase project "Buck Forecast" (wwugwzbdrzyqmypfpfut), 2026-11-20.
-- Kept as a record. No secrets: the collector token is generated inside the database.
-- 1. buck_storage_and_access: approved_users + is_approved(); tables buck_visits, people_events, daily_activity,
--    forecast_daily, weather_log, sun_moon, refresh_log; row-level security on all, read only for approved users.
-- 2. auto_approve_owner: allowed_emails (the owner's email address); trigger on auth.users that approves allowed emails on first sign-in.
-- 3. weather_schedule: pg_net + pg_cron; vault secret 'collector_token'; collector_token_ok(); job 'buck-weather-every-3-hours' (minute 7 every 3 hours) calls the weather function.
create table public.approved_users (user_id uuid primary key references auth.users(id) on delete cascade, label text not null, added_at timestamptz not null default now());
create table public.buck_visits (camera text not null, date date not null, time text not null, hour int not null, photos int not null, light text, legal_light text not null, sunrise text, sunset text, moon text, primary key (camera, date, time));
create table public.people_events (camera text not null, date date not null, time text not null, kind text not null check (kind in ('Feed drop','Other person')), seen text not null default 'yes' check (seen in ('yes','probable')), note text, primary key (camera, date, time));
create table public.daily_activity (camera text not null, date date not null, photos int not null, night_photos int not null, primary key (camera, date));
create table public.forecast_daily (date date primary key, high_f numeric, low_f numeric, precip_chance int, precip_type text, day_text text, night_text text, wind_text text, fetched_at timestamptz not null default now());
create table public.weather_log (date date primary key, high_f numeric, low_f numeric, precip_chance int, precip_type text, day_text text, logged_at timestamptz not null default now());
create table public.sun_moon (date date primary key, sunrise text not null, sunset text not null, legal_start text not null, legal_end text not null, moon_phase text, moon_age_days numeric);
create table public.refresh_log (id bigint generated always as identity primary key, source text not null check (source in ('cameras','weather')), at timestamptz not null default now(), ok boolean not null, note text);

-- 2026-11-20: hourly sit-window weather, doe counts, sit log
create table public.window_weather (date date not null, "window" text not null check ("window" in ('Morning','Evening')), wind_mph numeric, gust_mph numeric, pressure_change_hpa numeric, visibility_min_m numeric, snow_24h_in numeric, snow_30d_in numeric, snow_depth_in numeric, fetched_at timestamptz not null default now(), primary key (date, "window"));
create table public.window_weather_log (like public.window_weather including all);
create table public.doe_visits (camera text not null, date date not null, time text not null, does int not null default 1, photos int, legal_light text, note text, primary key (camera, date, time));
create table public.sit_log (id bigint generated always as identity primary key, date date not null, "window" text not null check ("window" in ('Morning','Evening')), stand text not null default 'Cam002', bucks int not null default 0, does int not null default 0, notes text, score int, rating text, factors jsonb, user_id uuid default auth.uid(), created_at timestamptz not null default now());
-- RLS on all four; "approved can read" (select) via public.is_approved(); sit_log also lets approved users add, change and delete.
