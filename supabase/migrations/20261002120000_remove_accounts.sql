-- Accounts removed: anyone can generate, and every new explanation is public.
--
-- Access model after this migration
--   * Anyone may read rows with visibility = 'public'. Rows saved as 'private'
--     before this migration stay private: nobody can read them through the
--     API any more, and they are not made public.
--   * There are still no INSERT/UPDATE/DELETE policies. The server writes with
--     the service role after validating the content and passing evaluation.
--   * Per-visitor rate limits key on a pseudonymous client key (an HMAC of the
--     client IP computed by the server) instead of a user id.

drop policy "Owners can read their own concepts" on public.concepts;

alter table public.concepts drop constraint concepts_ai_generated_has_owner;
alter table public.concepts drop constraint concepts_private_has_owner;
drop index public.concepts_owner_recent_idx;
drop index public.concepts_owner_request_idx;
alter table public.concepts drop column owner_id;
alter table public.concepts alter column visibility set default 'public';

-- Idempotency keys are random per submission, so they are unique on their own.
create unique index concepts_request_idx
  on public.concepts (generation_request_id)
  where generation_request_id is not null;

-- ---------------------------------------------------------------------------
-- Rate limit and single-flight lease, keyed by client key.
-- ---------------------------------------------------------------------------

drop function public.claim_generation_slot(uuid, uuid, integer, integer, integer, integer);
drop function public.release_generation_slot(uuid, uuid);

-- Old rows are keyed by user id and can never match a client key.
truncate private.generation_events, private.generation_leases;

alter table private.generation_events rename column user_id to client_key;
alter table private.generation_events alter column client_key type text;
alter index private.generation_events_user_recent_idx rename to generation_events_client_recent_idx;

alter table private.generation_leases rename column user_id to client_key;
alter table private.generation_leases alter column client_key type text;

create function public.claim_generation_slot(
  p_client_key text,
  p_request_id uuid,
  p_client_limit integer,
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
  -- Claims are short; one transaction-scoped lock keeps the per-client and
  -- global counts consistent under concurrency.
  perform pg_advisory_xact_lock(hashtextextended('generation-slot', 0));

  select l.expires_at into v_lease_expires
  from private.generation_leases l
  where l.client_key = p_client_key and l.expires_at > now();
  if found then
    return query select false, 'in_progress'::text,
      greatest(1, ceil(extract(epoch from v_lease_expires - now())))::integer;
    return;
  end if;

  select count(*), min(e.created_at) into v_count, v_oldest
  from private.generation_events e
  where e.client_key = p_client_key and e.created_at > now() - v_window;
  if v_count >= p_client_limit then
    return query select false, 'client_rate_limited'::text,
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

  insert into private.generation_events (client_key, request_id) values (p_client_key, p_request_id);
  insert into private.generation_leases (client_key, request_id, expires_at)
  values (p_client_key, p_request_id, now() + make_interval(secs => p_lease_seconds))
  on conflict (client_key) do update
    set request_id = excluded.request_id, expires_at = excluded.expires_at;

  delete from private.generation_events where created_at < now() - interval '2 days';

  return query select true, 'ok'::text, 0;
end;
$$;

create function public.release_generation_slot(p_client_key text, p_request_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.generation_leases
  where client_key = p_client_key and request_id = p_request_id;
$$;

revoke execute on function public.claim_generation_slot(text, uuid, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.release_generation_slot(text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_generation_slot(text, uuid, integer, integer, integer, integer)
  to service_role;
grant execute on function public.release_generation_slot(text, uuid) to service_role;
