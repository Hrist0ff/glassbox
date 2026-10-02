-- Concepts: validated, versioned scene content plus application-owned metadata.
--
-- Access model
--   * Anyone (anon or authenticated) may read rows with visibility = 'public'.
--   * Authenticated users may read their own rows.
--   * There are no INSERT/UPDATE/DELETE policies, so the API roles cannot
--     write at all. The server writes with the service role only after it has
--     verified the user, validated the content, and passed evaluation.

create type public.concept_visibility as enum ('public', 'private');
create type public.concept_origin as enum ('curated', 'ai_generated');

create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  schema_version smallint not null,
  -- The full canonical Concept JSON (schemaVersion, id, title, description, steps).
  content jsonb not null,
  owner_id uuid references auth.users (id) on delete cascade,
  visibility public.concept_visibility not null default 'private',
  origin public.concept_origin not null,
  -- Topic the user typed; null for curated content.
  source_topic text,
  -- Client idempotency key; lets a retried request find an already saved result.
  generation_request_id uuid,
  -- Model names, attempt count, latency, and token usage. Never prompts or keys.
  generation_meta jsonb,
  step_count integer generated always as (jsonb_array_length(content -> 'steps')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint concepts_title_length check (char_length(title) between 3 and 80),
  constraint concepts_description_length check (char_length(description) between 10 and 280),
  constraint concepts_schema_version check (schema_version = 1),
  constraint concepts_content_shape check (
    jsonb_typeof(content) = 'object'
    and jsonb_typeof(content -> 'steps') = 'array'
    and jsonb_array_length(content -> 'steps') between 4 and 12
  ),
  -- Columns used for listing must agree with the validated JSON.
  constraint concepts_content_matches_row check (
    content -> 'id' = to_jsonb(id::text)
    and content -> 'title' = to_jsonb(title)
    and content -> 'description' = to_jsonb(description)
    and content -> 'schemaVersion' = to_jsonb(schema_version::integer)
  ),
  -- Backstop only; the application enforces the precise 64 000-byte limit.
  constraint concepts_content_size check (octet_length(content::text) <= 100000),
  constraint concepts_source_topic_length check (
    source_topic is null or char_length(source_topic) between 3 and 120
  ),
  constraint concepts_ai_generated_has_owner check (origin <> 'ai_generated' or owner_id is not null),
  constraint concepts_private_has_owner check (visibility <> 'private' or owner_id is not null)
);

comment on table public.concepts is
  'Interactive explanations. content holds the canonical Concept JSON validated by the app (lib/concept/schema.ts).';

create index concepts_public_recent_idx on public.concepts (created_at desc) where visibility = 'public';
create index concepts_owner_recent_idx on public.concepts (owner_id, created_at desc);
create unique index concepts_owner_request_idx
  on public.concepts (owner_id, generation_request_id)
  where generation_request_id is not null;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger concepts_set_updated_at
before update on public.concepts
for each row execute function public.set_updated_at();

alter table public.concepts enable row level security;

create policy "Anyone can read public concepts"
on public.concepts for select
to anon, authenticated
using (visibility = 'public');

create policy "Owners can read their own concepts"
on public.concepts for select
to authenticated
using (owner_id = (select auth.uid()));

-- Defense in depth on top of "no write policies".
revoke insert, update, delete, truncate on public.concepts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Generation rate limit and single-flight lease.
--
-- Shared by every server instance, so the limit holds across a serverless
-- deployment. Tables live in a schema the Data API does not expose; the
-- functions are callable by the service role only.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.generation_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  request_id uuid not null,
  created_at timestamptz not null default now()
);
create index generation_events_user_recent_idx on private.generation_events (user_id, created_at desc);
create index generation_events_recent_idx on private.generation_events (created_at desc);

create table private.generation_leases (
  user_id uuid primary key,
  request_id uuid not null,
  expires_at timestamptz not null
);

alter table private.generation_events enable row level security;
alter table private.generation_leases enable row level security;

create function public.claim_generation_slot(
  p_user_id uuid,
  p_request_id uuid,
  p_user_limit integer,
  p_global_limit integer,
  p_window_seconds integer,
  p_lease_seconds integer
)
returns table (allowed boolean, reason text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := make_interval(secs => p_window_seconds);
  v_count integer;
  v_oldest timestamptz;
  v_lease_expires timestamptz;
begin
  -- Claims are short; one transaction-scoped lock keeps the per-user and
  -- global counts consistent under concurrency.
  perform pg_advisory_xact_lock(hashtextextended('generation-slot', 0));

  select l.expires_at into v_lease_expires
  from private.generation_leases l
  where l.user_id = p_user_id and l.expires_at > now();
  if found then
    return query select false, 'in_progress'::text,
      greatest(1, ceil(extract(epoch from v_lease_expires - now())))::integer;
    return;
  end if;

  select count(*), min(e.created_at) into v_count, v_oldest
  from private.generation_events e
  where e.user_id = p_user_id and e.created_at > now() - v_window;
  if v_count >= p_user_limit then
    return query select false, 'user_rate_limited'::text,
      greatest(1, ceil(extract(epoch from (v_oldest + v_window) - now())))::integer;
    return;
  end if;

  select count(*), min(e.created_at) into v_count, v_oldest
  from private.generation_events e
  where e.created_at > now() - v_window;
  if v_count >= p_global_limit then
    return query select false, 'global_rate_limited'::text,
      greatest(1, ceil(extract(epoch from (v_oldest + v_window) - now())))::integer;
    return;
  end if;

  insert into private.generation_events (user_id, request_id) values (p_user_id, p_request_id);
  insert into private.generation_leases (user_id, request_id, expires_at)
  values (p_user_id, p_request_id, now() + make_interval(secs => p_lease_seconds))
  on conflict (user_id) do update
    set request_id = excluded.request_id, expires_at = excluded.expires_at;

  delete from private.generation_events where created_at < now() - interval '2 days';

  return query select true, 'ok'::text, 0;
end;
$$;

create function public.release_generation_slot(p_user_id uuid, p_request_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.generation_leases
  where user_id = p_user_id and request_id = p_request_id;
$$;

revoke execute on function public.claim_generation_slot(uuid, uuid, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.release_generation_slot(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_generation_slot(uuid, uuid, integer, integer, integer, integer)
  to service_role;
grant execute on function public.release_generation_slot(uuid, uuid) to service_role;
