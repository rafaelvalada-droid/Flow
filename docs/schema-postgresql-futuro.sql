-- Modelagem proposta para a etapa multiusuário. NÃO é usada no MVP local.
-- A autenticação, as políticas de acesso por usuário e as migrações deverão ser implementadas antes de produção.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 google_sub text UNIQUE NOT NULL,
 email text NOT NULL,
 name text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL,
 color text NOT NULL DEFAULT '#3268DC',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES users(id),
 project_id uuid NOT NULL REFERENCES projects(id),
 title text NOT NULL,
 description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','waiting','done')),
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
 planned_at timestamptz,
 due_at timestamptz,
 completed_at timestamptz,
 gmail_thread_id text,
 gmail_url text,
 gmail_subject text,
 gmail_sender text,
 google_calendar_event_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE subtasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 title text NOT NULL,
 position int NOT NULL DEFAULT 0,
 done boolean NOT NULL DEFAULT false
);
CREATE TABLE time_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 started_at timestamptz NOT NULL,
 ended_at timestamptz,
 CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE INDEX tasks_by_owner_project_status ON tasks(owner_id,project_id,status);
CREATE INDEX tasks_by_due ON tasks(owner_id,due_at);
CREATE INDEX sessions_by_user ON time_sessions(user_id,started_at);
-- Na implementação real: usar transações e autorização para garantir uma sessão ativa por usuário.
