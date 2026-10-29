-- lb_init: history store for the DEFCON leaderboard (spec 16 section 5).
-- Server-side only. RLS is enabled everywhere with NO policies and anon/authenticated have no privileges,
-- so only the secret (service role) key can read or write. No raw scoreboard payload is stored.

create table public.lb_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text,
  starts_at timestamptz,
  freeze_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.lb_rounds (
  event_id uuid not null references public.lb_events (id),
  round int not null,
  captured_at timestamptz not null,
  primary key (event_id, round)
);

create table public.lb_scores (
  event_id uuid not null,
  round int not null,
  team_id text not null,
  team_name text not null,
  total numeric(14,3) not null,
  attack numeric(14,3),
  defense numeric(14,3),
  sla numeric(14,3),
  rank int not null,
  primary key (event_id, round, team_id),
  foreign key (event_id, round) references public.lb_rounds (event_id, round)
);

create index lb_scores_event_team_round_idx on public.lb_scores (event_id, team_id, round);

create table public.lb_audit (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  action text not null,
  actor text not null,
  details jsonb
);

-- Append-only: any UPDATE or DELETE raises.
create function public.lb_audit_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'lb_audit is append-only';
end;
$$;

create trigger lb_audit_no_change
  before update or delete on public.lb_audit
  for each row execute function public.lb_audit_immutable();

create trigger lb_audit_no_truncate
  before truncate on public.lb_audit
  for each statement execute function public.lb_audit_immutable();

alter table public.lb_events enable row level security;
alter table public.lb_rounds enable row level security;
alter table public.lb_scores enable row level security;
alter table public.lb_audit enable row level security;

revoke all on table public.lb_events, public.lb_rounds, public.lb_scores, public.lb_audit from anon, authenticated;
revoke all on function public.lb_audit_immutable() from public, anon, authenticated;
revoke all on sequence public.lb_audit_id_seq from anon, authenticated;
