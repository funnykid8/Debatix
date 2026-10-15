-- DEBATRIX Supabase schema
-- Run this in the Supabase SQL Editor for the project configured in public/index.html.
-- Review project settings and test with a non-owner account before relying on team data.

create extension if not exists pgcrypto;

create table if not exists public.preparations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('debate', 'mun')),
  title text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists preparations_user_created_idx
  on public.preparations (user_id, created_at desc);

create table if not exists public.shared_preparations (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('debate', 'mun')),
  title text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.debatrix_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12)),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.debatrix_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_idx on public.team_members(user_id);

create table if not exists public.team_preparations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.debatrix_teams(id) on delete cascade,
  title text not null,
  format text not null default 'School debate',
  content jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_preparations_team_updated_idx
  on public.team_preparations(team_id, updated_at desc);

alter table public.preparations enable row level security;
alter table public.shared_preparations enable row level security;
alter table public.debatrix_teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_preparations enable row level security;

drop policy if exists "Users manage their own preparations" on public.preparations;
create policy "Users manage their own preparations"
  on public.preparations for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Owners manage shared snapshots" on public.shared_preparations;
create policy "Owners manage shared snapshots"
  on public.shared_preparations for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create or replace function public.is_debatrix_team_member(target_team_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = target_team_id and tm.user_id = target_user_id
  );
$;

revoke all on function public.is_debatrix_team_member(uuid, uuid) from public;
grant execute on function public.is_debatrix_team_member(uuid, uuid) to authenticated;

drop policy if exists "Members can read their teams" on public.debatrix_teams;
create policy "Members can read their teams"
  on public.debatrix_teams for select to authenticated
  using (public.is_debatrix_team_member(id, auth.uid()));

drop policy if exists "Members can read memberships" on public.team_members;
create policy "Members can read memberships"
  on public.team_members for select to authenticated
  using (public.is_debatrix_team_member(team_members.team_id, auth.uid()));

drop policy if exists "Members can read team preparations" on public.team_preparations;
create policy "Members can read team preparations"
  on public.team_preparations for select to authenticated
  using (public.is_debatrix_team_member(team_preparations.team_id, auth.uid()));

drop policy if exists "Members can add team preparations" on public.team_preparations;
create policy "Members can add team preparations"
  on public.team_preparations for insert to authenticated
  with check (
    updated_by = auth.uid() and public.is_debatrix_team_member(team_preparations.team_id, auth.uid())
  );

drop policy if exists "Members can update team preparations" on public.team_preparations;
create policy "Members can update team preparations"
  on public.team_preparations for update to authenticated
  using (public.is_debatrix_team_member(team_preparations.team_id, auth.uid()))
  with check (
    updated_by = auth.uid() and public.is_debatrix_team_member(team_preparations.team_id, auth.uid())
  );

create or replace function public.create_debatrix_team(team_name text)
returns table (id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_team public.debatrix_teams;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if team_name is null or char_length(btrim(team_name)) < 1 or char_length(team_name) > 80 then
    raise exception 'Team name must be between 1 and 80 characters';
  end if;

  insert into public.debatrix_teams(name, owner_id)
  values (btrim(team_name), auth.uid())
  returning * into new_team;

  insert into public.team_members(team_id, user_id, role)
  values (new_team.id, auth.uid(), 'owner');

  return query select new_team.id, new_team.name, new_team.invite_code;
end;
$$;

create or replace function public.join_debatrix_team(invite_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_team public.debatrix_teams;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if invite_code is null or char_length(btrim(invite_code)) > 40 then
    raise exception 'Invalid invitation code';
  end if;

  select * into target_team
  from public.debatrix_teams t
  where upper(t.invite_code) = upper(btrim(invite_code));

  if target_team.id is null then
    raise exception 'Invitation code not found';
  end if;

  insert into public.team_members(team_id, user_id, role)
  values (target_team.id, auth.uid(), 'member')
  on conflict (team_id, user_id) do nothing;

  return true;
end;
$$;

create or replace function public.get_shared_preparation(share_token uuid)
returns table (id uuid, token uuid, owner_id uuid, mode text, title text, content jsonb, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.token, s.owner_id, s.mode, s.title, s.content, s.created_at
  from public.shared_preparations s
  where s.token = share_token
  limit 1;
$$;

revoke all on function public.create_debatrix_team(text) from public;
grant execute on function public.create_debatrix_team(text) to authenticated;
revoke all on function public.join_debatrix_team(text) from public;
grant execute on function public.join_debatrix_team(text) to authenticated;
revoke all on function public.get_shared_preparation(uuid) from public;
grant execute on function public.get_shared_preparation(uuid) to anon, authenticated;

grant select, insert, update, delete on public.preparations to authenticated;
grant select, insert, delete on public.shared_preparations to authenticated;
grant select on public.debatrix_teams to authenticated;
grant select on public.team_members to authenticated;
grant select, insert, update on public.team_preparations to authenticated;

-- Enable realtime notifications for shared team preparation changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_preparations'
  ) then
    alter publication supabase_realtime add table public.team_preparations;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication not found; enable Realtime for team_preparations in Supabase if desired.';
end;
$$;
