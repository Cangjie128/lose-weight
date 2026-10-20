-- Server-only credentials; never part of user records or backup exports.
create table if not exists public.google_summary_connections (
  user_id uuid primary key references auth.users(id),
  enabled boolean not null default false,
  token_ciphertext text not null,
  spreadsheet_id text,
  spreadsheet_url text,
  synced_rows integer not null default 0,
  last_synced_at timestamptz,
  sync_started_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.google_authorization_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id),
  expires_at timestamptz not null
);
create table if not exists public.mcp_read_tokens (
  user_id uuid primary key references auth.users(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  window_started_at timestamptz not null default now(),
  window_calls integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.google_summary_connections enable row level security;
alter table public.google_authorization_states enable row level security;
alter table public.mcp_read_tokens enable row level security;
revoke all on public.google_summary_connections,public.google_authorization_states,public.mcp_read_tokens from public,anon,authenticated;
grant all on public.google_summary_connections,public.google_authorization_states,public.mcp_read_tokens to service_role;

create or replace function public.reserve_summary_sync(p_user_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  update public.google_summary_connections set sync_started_at = now()
    where user_id = p_user_id and enabled and
      (sync_started_at is null or sync_started_at < now() - interval '60 seconds');
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
revoke all on function public.reserve_summary_sync(uuid) from public,anon,authenticated;
grant execute on function public.reserve_summary_sync(uuid) to service_role;

create or replace function public.reserve_mcp_read(p_hash text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare owner_id uuid;
begin
  update public.mcp_read_tokens set
    window_calls = case when window_started_at < now() - interval '1 minute' then 1 else window_calls + 1 end,
    window_started_at = case when window_started_at < now() - interval '1 minute' then now() else window_started_at end
    where token_hash = p_hash and not revoked and expires_at > now()
      and (window_started_at < now() - interval '1 minute' or window_calls < 60)
    returning user_id into owner_id;
  return owner_id;
end $$;
revoke all on function public.reserve_mcp_read(text) from public,anon,authenticated;
grant execute on function public.reserve_mcp_read(text) to service_role;
