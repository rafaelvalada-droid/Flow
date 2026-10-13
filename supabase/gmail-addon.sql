-- Run AFTER flow.sql. Scoped connection: list areas and append Gmail tasks only.
-- Re-executável. A v2 recebe a chave crua e calcula o SHA-256 aqui; a função antiga (hash enviado pelo cliente) fica só durante a transição.
begin;
create table if not exists public.flow_gmail_tokens (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '90 days'
);
alter table public.flow_gmail_tokens enable row level security;
revoke all on public.flow_gmail_tokens from public,anon,authenticated;
create or replace function public.flow_create_gmail_token(token_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if token_hash is null or token_hash !~ '^[a-f0-9]{64}$' then raise invalid_parameter_value; end if;
 if not exists(select 1 from public.flow_workspaces where user_id=auth.uid()) then raise exception 'Abra o Flow antes de conectar'; end if;
 -- Uma conexão por conta; conexões vencidas de qualquer conta são apagadas.
 delete from public.flow_gmail_tokens t where t.user_id=auth.uid() or t.expires_at<=now();
 insert into public.flow_gmail_tokens(token_hash,user_id) values(token_hash,auth.uid());
end;$$;
revoke all on function public.flow_create_gmail_token(text) from public,anon;
grant execute on function public.flow_create_gmail_token(text) to authenticated;
create or replace function public.flow_revoke_gmail_token()
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 delete from public.flow_gmail_tokens where user_id=auth.uid();
end;$$;
revoke all on function public.flow_revoke_gmail_token() from public,anon;
grant execute on function public.flow_revoke_gmail_token() to authenticated;

-- Internas: sem EXECUTE para public/anon/authenticated; só as funções security definer abaixo as chamam.
create or replace function public.flow_gmail_token_owner(token_hash text)
returns uuid language plpgsql set search_path='' as $$
declare owner_id uuid;
begin
 delete from public.flow_gmail_tokens t where t.expires_at<=now();
 select t.user_id into owner_id from public.flow_gmail_tokens t where t.token_hash=flow_gmail_token_owner.token_hash and t.expires_at>now() for share;
 if owner_id is null then raise sqlstate 'PT401' using message='Conexão vencida. Gere outra conexão no UlbraFlow.'; end if;
 return owner_id;
end;$$;
revoke all on function public.flow_gmail_token_owner(text) from public,anon,authenticated;
create or replace function public.flow_gmail_capture_apply(owner_id uuid, action text, payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare workspace jsonb; task jsonb; task_id text; new_revision integer; due text; thread_id text; message_id text;
begin
 select data,revision into workspace,new_revision from public.flow_workspaces where user_id=owner_id for update;
 if workspace is null then raise exception 'Workspace não encontrado'; end if;
 if action='areas' then
  return jsonb_build_object('projects',coalesce((select jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name')) from jsonb_array_elements(workspace->'projects') p),'[]'::jsonb));
 end if;
 if action is distinct from 'save' then raise invalid_parameter_value; end if;
 if payload is null or octet_length(payload::text)>5000
  or length(trim(coalesce(payload->>'title','')))=0 or length(payload->>'title')>180
  or coalesce(payload->>'captureId','') !~ '^[a-zA-Z0-9_-]{8,150}$'
  or coalesce(payload->>'gmailUrl','') !~ '^https://mail\.google\.com/mail/\?authuser=[a-zA-Z0-9._%+-]+#all/[a-f0-9]{8,40}$'
  or not exists(select 1 from jsonb_array_elements(workspace->'projects') p where p->>'id'=payload->>'projectId') then
  raise invalid_parameter_value using message='Demanda inválida. Escolha uma área atualizada.';
 end if;
 -- O ID da conversa (hexadecimal minúsculo da Gmail API) vem do link validado; gmailThreadId, se enviado, precisa coincidir.
 thread_id:=substring(payload->>'gmailUrl' from '#all/([a-f0-9]{8,40})$');
 if coalesce(payload->>'gmailThreadId',thread_id)<>thread_id then raise invalid_parameter_value using message='Conversa do Gmail inválida.'; end if;
 message_id:=case when coalesce(payload->>'gmailMessageId','') ~ '^[a-f0-9]{8,40}$' then payload->>'gmailMessageId' end;
 due:=payload->>'dueDate';
 if coalesce(due,'') !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_parameter_value using message='Informe o prazo no formato AAAA-MM-DD'; end if;
 if to_char(due::date,'YYYY-MM-DD')<>due then raise invalid_parameter_value; end if;
 -- A mesma conversa capturada por qualquer origem (celular, extensão, Entrada) não gera outra tarefa.
 select t->>'id' into task_id from jsonb_array_elements(workspace->'tasks') t
  where t->>'gmailCaptureId' in (payload->>'captureId','gmail-mobile-'||thread_id,'gmail-review-'||thread_id)
   or lower(t->>'gmailThreadId')=thread_id
   or right(coalesce(t->>'gmailUrl',''),length(thread_id)+5)='#all/'||thread_id
  limit 1;
 if task_id is not null then return jsonb_build_object('taskId',task_id,'duplicate',true); end if;
 task_id:=gen_random_uuid()::text;
 task:=jsonb_build_object('id',task_id,'title',trim(payload->>'title'),'project',payload->>'projectId','status','todo','priority','medium','dueDate',due,'plannedDate','','plannedTime','','description','','subtasks','[]'::jsonb,'sessions','[]'::jsonb,'startedAt',null,'focusCycles',0,'completedAt',null,'createdAt',floor(extract(epoch from now())*1000),'gmailUrl',payload->>'gmailUrl','gmailSubject',left(payload->>'gmailSubject',180),'gmailSender',left(payload->>'gmailSender',150),'gmailCaptureId',payload->>'captureId','gmailThreadId',thread_id);
 if message_id is not null then task:=task||jsonb_build_object('gmailMessageId',message_id); end if;
 workspace:=jsonb_set(workspace,'{tasks}',jsonb_build_array(task)||(workspace->'tasks'));
 if octet_length(workspace::text)>2000000 then raise exception 'Workspace atingiu o limite de tamanho'; end if;
 update public.flow_workspaces set data=workspace,revision=revision+1,updated_at=now() where user_id=owner_id returning revision into new_revision;
 return jsonb_build_object('taskId',task_id,'revision',new_revision);
end;$$;
revoke all on function public.flow_gmail_capture_apply(uuid,text,jsonb) from public,anon,authenticated;

-- v2: chave crua, hash calculado no banco.
create or replace function public.flow_gmail_capture_v2(token text, action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if token is null or token !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT401' using message='Conexão inválida. Gere outra conexão no UlbraFlow.'; end if;
 return public.flow_gmail_capture_apply(public.flow_gmail_token_owner(encode(sha256(convert_to(token,'UTF8')),'hex')),action,payload);
end;$$;
revoke all on function public.flow_gmail_capture_v2(text,text,jsonb) from public;
grant execute on function public.flow_gmail_capture_v2(text,text,jsonb) to anon,authenticated;

-- Transição: complementos antigos ainda enviam token_hash. Remova depois de atualizar o Code.gs (veja gmail-addon/README.md):
--   drop function if exists public.flow_gmail_capture(text,text,jsonb);
create or replace function public.flow_gmail_capture(token_hash text, action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if token_hash is null or token_hash !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT401' using message='Conexão vencida. Gere outra conexão no Flow.'; end if;
 return public.flow_gmail_capture_apply(public.flow_gmail_token_owner(token_hash),action,payload);
end;$$;
revoke all on function public.flow_gmail_capture(text,text,jsonb) from public;
grant execute on function public.flow_gmail_capture(text,text,jsonb) to anon,authenticated;
commit;
