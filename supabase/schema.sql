create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null default current_date,
  gender text not null default '女性',
  height_cm numeric(5,2) not null default 156,
  current_weight_kg numeric(5,2) not null default 56,
  starting_weight_kg numeric(5,2) not null default 56,
  target_weight_kg numeric(5,2) not null default 51,
  challenge_start_date date not null default current_date,
  challenge_end_date date not null default (current_date + 55),
  weekly_exercise_goal integer not null default 4,
  water_goal_ml integer not null default 1800,
  diet_preferences text not null default '',
  disliked_foods text not null default '',
  health_notes text not null default '',
  is_menstrual_period boolean not null default false,
  ai_enabled boolean not null default true,
  ai_model text not null default '由服务端 OPENAI_MODEL 控制',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null default current_date,
  start_date date not null,
  end_date date not null,
  start_weight_kg numeric(5,2) not null,
  target_weight_kg numeric(5,2) not null,
  weekly_exercise_goal integer not null default 4,
  water_goal_ml integer not null default 1800,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weight_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null,
  weight_kg numeric(5,2) not null check (weight_kg between 30 and 200),
  note text not null default '',
  high_salt boolean not null default false,
  late_dinner boolean not null default false,
  menstrual_period boolean not null default false,
  bowel_movement boolean not null default false,
  poor_sleep boolean not null default false,
  hard_training_previous_day boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, record_date)
);

create table if not exists public.meal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  food_name text not null,
  portion text not null default '',
  notes text not null default '',
  ai_analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meal_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null,
  meal_record_id uuid not null references public.meal_records(id) on delete cascade,
  storage_path text not null,
  file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null,
  exercise_type text not null check (exercise_type in ('跑步', '游泳', '步行', '羽毛球', '力量训练', '其他')),
  duration_min integer not null check (duration_min > 0),
  distance_km numeric(6,2),
  intensity text not null check (intensity in ('低', '中', '高')),
  calories_burned integer,
  feeling text not null default '',
  has_discomfort boolean not null default false,
  discomfort_detail text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null,
  tasks jsonb not null default '{}'::jsonb,
  water_ml integer not null default 0,
  sleep_hours numeric(4,1),
  body_feeling text not null default '',
  bowel_movement boolean not null default false,
  menstrual_period boolean not null default false,
  completion_score integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, record_date)
);

create table if not exists public.daily_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null,
  summary jsonb not null,
  source_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, record_date)
);

create index if not exists challenges_user_status_idx on public.challenges(user_id, status);
create index if not exists weight_records_user_date_idx on public.weight_records(user_id, record_date);
create index if not exists meal_records_user_date_idx on public.meal_records(user_id, record_date);
create index if not exists meal_images_meal_idx on public.meal_images(meal_record_id);
create index if not exists exercise_records_user_date_idx on public.exercise_records(user_id, record_date);
create index if not exists daily_checkins_user_date_idx on public.daily_checkins(user_id, record_date);
create index if not exists daily_ai_summaries_user_date_idx on public.daily_ai_summaries(user_id, record_date);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_challenges_updated_at on public.challenges;
create trigger set_challenges_updated_at before update on public.challenges
for each row execute function public.set_updated_at();

drop trigger if exists set_weight_records_updated_at on public.weight_records;
create trigger set_weight_records_updated_at before update on public.weight_records
for each row execute function public.set_updated_at();

drop trigger if exists set_meal_records_updated_at on public.meal_records;
create trigger set_meal_records_updated_at before update on public.meal_records
for each row execute function public.set_updated_at();

drop trigger if exists set_meal_images_updated_at on public.meal_images;
create trigger set_meal_images_updated_at before update on public.meal_images
for each row execute function public.set_updated_at();

drop trigger if exists set_exercise_records_updated_at on public.exercise_records;
create trigger set_exercise_records_updated_at before update on public.exercise_records
for each row execute function public.set_updated_at();

drop trigger if exists set_daily_checkins_updated_at on public.daily_checkins;
create trigger set_daily_checkins_updated_at before update on public.daily_checkins
for each row execute function public.set_updated_at();

drop trigger if exists set_daily_ai_summaries_updated_at on public.daily_ai_summaries;
create trigger set_daily_ai_summaries_updated_at before update on public.daily_ai_summaries
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.challenges enable row level security;
alter table public.weight_records enable row level security;
alter table public.meal_records enable row level security;
alter table public.meal_images enable row level security;
alter table public.exercise_records enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.daily_ai_summaries enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;
drop policy if exists "challenges_select_own" on public.challenges;
drop policy if exists "challenges_insert_own" on public.challenges;
drop policy if exists "challenges_update_own" on public.challenges;
drop policy if exists "challenges_delete_own" on public.challenges;
drop policy if exists "weight_select_own" on public.weight_records;
drop policy if exists "weight_insert_own" on public.weight_records;
drop policy if exists "weight_update_own" on public.weight_records;
drop policy if exists "weight_delete_own" on public.weight_records;
drop policy if exists "meals_select_own" on public.meal_records;
drop policy if exists "meals_insert_own" on public.meal_records;
drop policy if exists "meals_update_own" on public.meal_records;
drop policy if exists "meals_delete_own" on public.meal_records;
drop policy if exists "meal_images_select_own" on public.meal_images;
drop policy if exists "meal_images_insert_own" on public.meal_images;
drop policy if exists "meal_images_update_own" on public.meal_images;
drop policy if exists "meal_images_delete_own" on public.meal_images;
drop policy if exists "exercise_select_own" on public.exercise_records;
drop policy if exists "exercise_insert_own" on public.exercise_records;
drop policy if exists "exercise_update_own" on public.exercise_records;
drop policy if exists "exercise_delete_own" on public.exercise_records;
drop policy if exists "checkins_select_own" on public.daily_checkins;
drop policy if exists "checkins_insert_own" on public.daily_checkins;
drop policy if exists "checkins_update_own" on public.daily_checkins;
drop policy if exists "checkins_delete_own" on public.daily_checkins;
drop policy if exists "summaries_select_own" on public.daily_ai_summaries;
drop policy if exists "summaries_insert_own" on public.daily_ai_summaries;
drop policy if exists "summaries_update_own" on public.daily_ai_summaries;
drop policy if exists "summaries_delete_own" on public.daily_ai_summaries;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profiles_delete_own" on public.profiles for delete using (auth.uid() = user_id);

create policy "challenges_select_own" on public.challenges for select using (auth.uid() = user_id);
create policy "challenges_insert_own" on public.challenges for insert with check (auth.uid() = user_id);
create policy "challenges_update_own" on public.challenges for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "challenges_delete_own" on public.challenges for delete using (auth.uid() = user_id);

create policy "weight_select_own" on public.weight_records for select using (auth.uid() = user_id);
create policy "weight_insert_own" on public.weight_records for insert with check (auth.uid() = user_id);
create policy "weight_update_own" on public.weight_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "weight_delete_own" on public.weight_records for delete using (auth.uid() = user_id);

create policy "meals_select_own" on public.meal_records for select using (auth.uid() = user_id);
create policy "meals_insert_own" on public.meal_records for insert with check (auth.uid() = user_id);
create policy "meals_update_own" on public.meal_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meals_delete_own" on public.meal_records for delete using (auth.uid() = user_id);

create policy "meal_images_select_own" on public.meal_images for select using (auth.uid() = user_id);
create policy "meal_images_insert_own" on public.meal_images for insert with check (auth.uid() = user_id);
create policy "meal_images_update_own" on public.meal_images for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meal_images_delete_own" on public.meal_images for delete using (auth.uid() = user_id);

create policy "exercise_select_own" on public.exercise_records for select using (auth.uid() = user_id);
create policy "exercise_insert_own" on public.exercise_records for insert with check (auth.uid() = user_id);
create policy "exercise_update_own" on public.exercise_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exercise_delete_own" on public.exercise_records for delete using (auth.uid() = user_id);

create policy "checkins_select_own" on public.daily_checkins for select using (auth.uid() = user_id);
create policy "checkins_insert_own" on public.daily_checkins for insert with check (auth.uid() = user_id);
create policy "checkins_update_own" on public.daily_checkins for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "checkins_delete_own" on public.daily_checkins for delete using (auth.uid() = user_id);

create policy "summaries_select_own" on public.daily_ai_summaries for select using (auth.uid() = user_id);
create policy "summaries_insert_own" on public.daily_ai_summaries for insert with check (auth.uid() = user_id);
create policy "summaries_update_own" on public.daily_ai_summaries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "summaries_delete_own" on public.daily_ai_summaries for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-images',
  'meal-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "meal_images_storage_select_own" on storage.objects;
drop policy if exists "meal_images_storage_insert_own" on storage.objects;
drop policy if exists "meal_images_storage_update_own" on storage.objects;
drop policy if exists "meal_images_storage_delete_own" on storage.objects;

create policy "meal_images_storage_select_own"
on storage.objects for select
using (
  bucket_id = 'meal-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "meal_images_storage_insert_own"
on storage.objects for insert
with check (
  bucket_id = 'meal-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "meal_images_storage_update_own"
on storage.objects for update
using (
  bucket_id = 'meal-images'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'meal-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "meal_images_storage_delete_own"
on storage.objects for delete
using (
  bucket_id = 'meal-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);
