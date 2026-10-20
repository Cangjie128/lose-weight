-- Design-stage schema for a NEW self-hosted PostgreSQL database; never run on production automatically.
create schema if not exists shiguang;
create table if not exists shiguang.accounts (
  id uuid primary key default gen_random_uuid(),email text not null,password_hash text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists shiguang_email_unique on shiguang.accounts(lower(email));
create table if not exists shiguang.sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  owner_id uuid not null references shiguang.accounts(id),expires_at timestamptz not null,revoked_at timestamptz
);
create table if not exists shiguang.snapshots (
  owner_id uuid primary key references shiguang.accounts(id),revision bigint not null default 0 check (revision >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),updated_at timestamptz not null default now()
);
create table if not exists shiguang.photos (
  owner_id uuid not null references shiguang.accounts(id),id text not null,
  relative_path text not null check (relative_path !~ '(^/|\.\.|\\)'),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),bytes bigint not null check (bytes > 0),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  retained boolean not null default false,primary key(owner_id,id)
);
create table if not exists shiguang.ai_usage (
  owner_id uuid not null references shiguang.accounts(id),usage_date date not null,
  calls integer not null default 0 check (calls >= 0),input_tokens bigint not null default 0,output_tokens bigint not null default 0,
  primary key(owner_id,usage_date)
);
-- The application uses a non-owner, non-superuser, NOBYPASSRLS DB role.
-- Each transaction sets a validated principal with SET LOCAL app.owner_id.
alter table shiguang.snapshots enable row level security;
alter table shiguang.photos enable row level security;
alter table shiguang.ai_usage enable row level security;
drop policy if exists snapshot_owner on shiguang.snapshots;
create policy snapshot_owner on shiguang.snapshots using(owner_id = nullif(current_setting('app.owner_id',true),'')::uuid) with check(owner_id = nullif(current_setting('app.owner_id',true),'')::uuid);
drop policy if exists photo_owner on shiguang.photos;
create policy photo_owner on shiguang.photos using(owner_id = nullif(current_setting('app.owner_id',true),'')::uuid) with check(owner_id = nullif(current_setting('app.owner_id',true),'')::uuid);
drop policy if exists usage_owner on shiguang.ai_usage;
create policy usage_owner on shiguang.ai_usage using(owner_id = nullif(current_setting('app.owner_id',true),'')::uuid) with check(owner_id = nullif(current_setting('app.owner_id',true),'')::uuid);
revoke all on schema shiguang from public;
revoke all on all tables in schema shiguang from public;
