-- Additive learning-loop storage. Runtime access is through the authenticated
-- Railway API only; these tables are deliberately not exposed to browser roles.

alter table public.projects add column if not exists developer_source_value text;

create table if not exists public.agent_memory (
  id bigserial primary key,
  memory_type text not null,
  subject_type text not null,
  subject_id text,
  memory_key text not null,
  value_json jsonb not null default '{}'::jsonb,
  summary text not null,
  confidence text not null default 'low' check (confidence in ('low', 'medium', 'high')),
  source text not null,
  source_reference text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  times_observed integer not null default 1 check (times_observed > 0),
  status text not null default 'active' check (status in ('active', 'candidate', 'superseded', 'expired', 'rejected')),
  superseded_by bigint references public.agent_memory(id) on delete set null,
  created_by integer references public.app_users(id) on delete set null,
  fingerprint text not null unique
);

create table if not exists public.agent_knowledge (
  id bigserial primary key,
  knowledge_type text not null,
  subject_type text not null,
  subject_id text,
  canonical_key text not null,
  value_json jsonb not null default '{}'::jsonb,
  summary text not null,
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  approval_status text not null default 'candidate' check (approval_status in ('candidate', 'approved', 'rejected', 'superseded')),
  approved_by integer references public.app_users(id) on delete set null,
  approved_at timestamptz,
  rejected_by integer references public.app_users(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  evidence_count integer not null default 0 check (evidence_count >= 0),
  source_memory_ids bigint[] not null default '{}',
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  superseded_by bigint references public.agent_knowledge(id) on delete set null
);

create table if not exists public.agent_feedback (
  id bigserial primary key,
  action_type text not null,
  entity_type text not null,
  entity_id text,
  original_value jsonb,
  corrected_value jsonb,
  feedback_type text not null,
  reason text,
  user_id integer not null references public.app_users(id) on delete restrict,
  duplicate_project_id integer references public.projects(id) on delete restrict,
  canonical_project_id integer references public.projects(id) on delete restrict,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.agent_learning_events (
  id bigserial primary key,
  action_type text not null,
  entity_type text not null,
  entity_id text,
  context_json jsonb not null default '{}'::jsonb,
  outcome text not null,
  duration_ms integer,
  source_name text,
  project_count integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.agent_knowledge_conflicts (
  id bigserial primary key,
  knowledge_type text not null,
  subject_type text not null,
  subject_id text,
  canonical_key text not null,
  knowledge_ids bigint[] not null default '{}',
  memory_ids bigint[] not null default '{}',
  summary text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by integer references public.app_users(id) on delete set null,
  resolved_at timestamptz,
  resolution text,
  resolution_action text check (resolution_action in ('select_preferred', 'reject_value', 'dismiss')),
  selected_knowledge_id bigint references public.agent_knowledge(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists agent_memory_scope_idx
  on public.agent_memory(subject_type, subject_id, memory_type, status);
create index if not exists agent_memory_last_seen_idx
  on public.agent_memory(last_seen_at desc);
create index if not exists agent_knowledge_scope_idx
  on public.agent_knowledge(subject_type, subject_id, knowledge_type, approval_status);
create index if not exists agent_feedback_entity_idx
  on public.agent_feedback(entity_type, entity_id, created_at desc);
create index if not exists agent_feedback_duplicate_idx
  on public.agent_feedback(duplicate_project_id, canonical_project_id) where duplicate_project_id is not null;
create index if not exists agent_learning_events_source_idx
  on public.agent_learning_events(source_name, action_type, created_at desc);
create index if not exists agent_learning_events_expiry_idx
  on public.agent_learning_events(expires_at) where expires_at is not null;
create index if not exists agent_knowledge_conflicts_open_idx
  on public.agent_knowledge_conflicts(status, created_at desc);

alter table public.agent_memory enable row level security;
alter table public.agent_knowledge enable row level security;
alter table public.agent_feedback enable row level security;
alter table public.agent_learning_events enable row level security;
alter table public.agent_knowledge_conflicts enable row level security;

revoke all privileges on table public.agent_memory from anon, authenticated;
revoke all privileges on table public.agent_knowledge from anon, authenticated;
revoke all privileges on table public.agent_feedback from anon, authenticated;
revoke all privileges on table public.agent_learning_events from anon, authenticated;
revoke all privileges on table public.agent_knowledge_conflicts from anon, authenticated;
revoke all privileges on sequence public.agent_memory_id_seq from anon, authenticated;
revoke all privileges on sequence public.agent_knowledge_id_seq from anon, authenticated;
revoke all privileges on sequence public.agent_feedback_id_seq from anon, authenticated;
revoke all privileges on sequence public.agent_learning_events_id_seq from anon, authenticated;
revoke all privileges on sequence public.agent_knowledge_conflicts_id_seq from anon, authenticated;

comment on table public.agent_memory is 'Deduplicated runtime observations; never authoritative business rules.';
comment on table public.agent_knowledge is 'Provenance-preserving reusable truth with explicit approval state.';
comment on table public.agent_feedback is 'Authenticated user corrections and confirmations.';
comment on table public.agent_learning_events is 'Bounded action/context/outcome telemetry for deterministic learning.';
comment on table public.agent_knowledge_conflicts is 'Conflicting evidence retained until explicit administrative resolution.';
