-- Run in the Supabase SQL Editor. No service_role key is used by the app.
begin;
create table if not exists public.flow_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.flow_workspaces enable row level security;
revoke all on public.flow_workspaces from anon, authenticated;
grant select on public.flow_workspaces to authenticated;
drop policy if exists flow_read_own_workspace on public.flow_workspaces;
create policy flow_read_own_workspace on public.flow_workspaces
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.flow_save_workspace(workspace_data jsonb, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  new_revision integer;
begin
  if owner_id is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if workspace_data->>'version' is distinct from '1'
    or jsonb_typeof(workspace_data->'tasks') is distinct from 'array'
    or jsonb_typeof(workspace_data->'projects') is distinct from 'array'
    or octet_length(workspace_data::text) > 2000000 then
    raise invalid_parameter_value using message = 'Invalid Flow workspace (maximum 2 MB)';
  end if;
  if expected_revision = 0 then
    insert into public.flow_workspaces(user_id, data, revision)
      values (owner_id, workspace_data, 1)
      on conflict (user_id) do nothing returning revision into new_revision;
  else
    update public.flow_workspaces set data = workspace_data, revision = revision + 1, updated_at = now()
      where user_id = owner_id and revision = expected_revision returning revision into new_revision;
  end if;
  if new_revision is null then raise sqlstate 'PT409' using message = 'Workspace revision conflict'; end if;
  return jsonb_build_object('revision', new_revision);
end;
$$;
revoke all on function public.flow_save_workspace(jsonb, integer) from public, anon;
grant execute on function public.flow_save_workspace(jsonb, integer) to authenticated;
commit;
