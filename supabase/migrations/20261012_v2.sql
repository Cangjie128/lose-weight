-- Apply after schema.sql to a dedicated test project first. No user rows are deleted.
alter table public.profiles add column if not exists age integer;
alter table public.profiles add column if not exists activity_level text not null default 'light';
alter table public.profiles add column if not exists exercise_preferences jsonb not null default '["步行","力量训练"]';
alter table public.profiles add column if not exists nutrition_targets jsonb;
alter table public.profiles add column if not exists needs_professional_guidance boolean not null default false;
alter table public.meal_records add column if not exists nutrition jsonb;
alter table public.meal_images add column if not exists size_bytes bigint;
alter table public.meal_images add column if not exists mime_type text;
alter table public.meal_images add column if not exists sha256 text;
alter table public.daily_checkins add column if not exists fatigue_level integer not null default 0;

create unique index if not exists meals_id_owner_idx on public.meal_records(id, user_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meal_images_parent_owner') then
    alter table public.meal_images add constraint meal_images_parent_owner
      foreign key (meal_record_id, user_id) references public.meal_records(id, user_id) not valid;
  end if;
end $$;
drop policy if exists "meal_images_insert_own" on public.meal_images;
drop policy if exists "meal_images_update_own" on public.meal_images;
create policy "meal_images_insert_own" on public.meal_images for insert with check (
  auth.uid() = user_id and storage_path like auth.uid()::text || '/%'
  and exists (select 1 from public.meal_records m where m.id = meal_record_id and m.user_id = auth.uid())
);
create policy "meal_images_update_own" on public.meal_images for update using (auth.uid() = user_id) with check (
  auth.uid() = user_id and storage_path like auth.uid()::text || '/%'
  and exists (select 1 from public.meal_records m where m.id = meal_record_id and m.user_id = auth.uid())
);

create table if not exists public.ai_usage_daily (
  user_id uuid not null references auth.users(id),
  usage_date date not null,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, usage_date)
);
create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  provider text not null check (provider in ('deepseek','openai')),
  status text not null default 'reserved' check (status in ('reserved','success','failed')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  error_code text
);
alter table public.ai_usage_daily enable row level security;
alter table public.ai_requests enable row level security;
drop policy if exists "ai_usage_select_own" on public.ai_usage_daily;
drop policy if exists "ai_requests_select_own" on public.ai_requests;
create policy "ai_usage_select_own" on public.ai_usage_daily for select using (auth.uid() = user_id);
create policy "ai_requests_select_own" on public.ai_requests for select using (auth.uid() = user_id);
grant select on public.ai_usage_daily, public.ai_requests to authenticated;
revoke insert,update,delete on public.ai_usage_daily, public.ai_requests from anon, authenticated;

create or replace function public.reserve_ai_call(p_provider text, p_user_limit integer default 20, p_global_limit integer default 100)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  day_key date := (now() at time zone 'UTC')::date;
  used integer;
  global_used integer;
  request_id uuid;
begin
  if owner_id is null or p_provider not in ('deepseek','openai') then raise exception 'AI_AUTH_REQUIRED'; end if;
  -- A database lock makes reservations atomic across workers and devices.
  perform pg_advisory_xact_lock(hashtext('lose-weight-ai-' || day_key::text));
  select coalesce(sum(calls),0) into global_used from public.ai_usage_daily where usage_date = day_key;
  select coalesce(calls,0) into used from public.ai_usage_daily where user_id = owner_id and usage_date = day_key;
  if coalesce(used,0) >= least(greatest(p_user_limit,1),20) or global_used >= least(greatest(p_global_limit,1),100) then raise exception 'AI_DAILY_LIMIT'; end if;
  if exists (select 1 from public.ai_requests where user_id = owner_id and created_at > now() - interval '10 seconds') then raise exception 'AI_RATE_LIMIT'; end if;
  insert into public.ai_usage_daily(user_id,usage_date,calls) values(owner_id,day_key,1)
    on conflict(user_id,usage_date) do update set calls = public.ai_usage_daily.calls + 1;
  insert into public.ai_requests(user_id,provider) values(owner_id,p_provider) returning id into request_id;
  return request_id;
end $$;
revoke all on function public.reserve_ai_call(text,integer,integer) from public, anon;
grant execute on function public.reserve_ai_call(text,integer,integer) to authenticated;

create or replace function public.finish_ai_call(p_id uuid, p_success boolean, p_input_tokens integer default 0, p_output_tokens integer default 0, p_error_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare day_key date;
begin
  update public.ai_requests set status = case when p_success then 'success' else 'failed' end,
    input_tokens = greatest(0,least(p_input_tokens,100000)), output_tokens = greatest(0,least(p_output_tokens,5000)), error_code = left(p_error_code,40)
    where id = p_id and user_id = auth.uid() and status = 'reserved'
    returning (created_at at time zone 'UTC')::date into day_key;
  if day_key is not null then
    update public.ai_usage_daily set input_tokens = input_tokens + greatest(0,least(p_input_tokens,100000)),
      output_tokens = output_tokens + greatest(0,least(p_output_tokens,5000)) where user_id = auth.uid() and usage_date = day_key;
  end if;
end $$;
revoke all on function public.finish_ai_call(uuid,boolean,integer,integer,text) from public, anon;
grant execute on function public.finish_ai_call(uuid,boolean,integer,integer,text) to authenticated;

-- All structured records are merged in one RLS-protected PostgreSQL transaction.
create or replace function public.restore_v2_backup(p_data jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  v_table_name text;
  records jsonb;
  item jsonb;
  updates text;
  conflict_columns text;
begin
  if owner_id is null then raise exception 'Login required'; end if;
  foreach v_table_name in array array['profiles','challenges','weight_records','meal_records','meal_images','exercise_records','daily_checkins','daily_ai_summaries'] loop
    records := case v_table_name
      when 'profiles' then jsonb_build_array(p_data->'profile')
      when 'challenges' then jsonb_build_array(p_data->'challenge')
      when 'weight_records' then p_data->'weights'
      when 'meal_records' then p_data->'meals'
      when 'meal_images' then coalesce((select jsonb_agg(photo) from jsonb_array_elements(p_data->'meals') meal cross join lateral jsonb_array_elements(meal->'images') photo),'[]')
      when 'exercise_records' then p_data->'exercises'
      when 'daily_checkins' then p_data->'checkins'
      when 'daily_ai_summaries' then p_data->'summaries' end;
    if records is null or jsonb_typeof(records) <> 'array' then raise exception 'Invalid backup records'; end if;
    select string_agg(format('%I = excluded.%I',column_name,column_name),',') into updates
      from information_schema.columns where table_schema = 'public' and information_schema.columns.table_name = v_table_name
        and column_name not in ('id','user_id','created_at');
    conflict_columns := case when v_table_name = 'profiles' then 'user_id'
      when v_table_name in ('weight_records','daily_checkins','daily_ai_summaries') then 'user_id, record_date' else 'id' end;
    for item in select value from jsonb_array_elements(records) loop
      if item->>'user_id' is distinct from owner_id::text then raise exception 'Backup owner mismatch'; end if;
      if v_table_name = 'meal_images' and (item->>'storage_path' not like owner_id::text || '/%' or item->>'storage_path' like '%..%') then raise exception 'Invalid private image path'; end if;
      item := jsonb_build_object('created_at',now(),'updated_at',now()) || item;
      execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).* on conflict (%s) do update set %s where %I.user_id = auth.uid()', v_table_name, v_table_name, conflict_columns, updates, v_table_name) using item;
    end loop;
  end loop;
end $$;
revoke all on function public.restore_v2_backup(jsonb) from public, anon;
grant execute on function public.restore_v2_backup(jsonb) to authenticated;
