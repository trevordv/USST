create table if not exists public.scans (
  id serial primary key,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  sources_scanned integer not null default 0,
  projects_found integer not null default 0,
  new_projects integer not null default 0,
  error_message text
);

create table if not exists public.projects (
  id serial primary key,
  name text not null,
  description text,
  capacity_mw numeric(10,2) not null,
  developer text,
  epc text,
  location text,
  country text not null default 'AU',
  status text not null default 'announced',
  source_url text,
  source_name text,
  contact_name text,
  contact_email text,
  contact_phone text,
  announced_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  scan_id integer
);

create table if not exists public.scan_projects (
  id serial primary key,
  scan_id integer not null,
  project_id integer not null,
  project_name text,
  is_new boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_enrichments (
  id serial primary key,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  checked integer not null default 0,
  updated integer not null default 0,
  error_message text
);

create table if not exists public.pvh_contacts (
  id serial primary key,
  first_name text,
  middle_name text,
  last_name text,
  organization_name text,
  organization_title text,
  email1 text,
  email2 text,
  created_at timestamptz not null default now()
);

create table if not exists public.epbc_projects (
  id serial primary key,
  epbc_number text not null unique,
  project_name text not null,
  proponent text,
  industry_type text,
  project_status text,
  decision_status text,
  state text,
  location text,
  technology_type text,
  size_mw numeric,
  referral_date text,
  approval_date text,
  source_url text,
  raw_description text,
  is_renewable boolean not null default false,
  is_solar boolean not null default false,
  is_approved boolean not null default false,
  relevance_status text not null default 'pending',
  scraped_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists public.access_tokens (
  id serial primary key,
  token text not null unique,
  label text,
  recipient_email text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);

create table if not exists public.app_users (
  id serial primary key,
  email text not null unique,
  auth_user_id uuid unique,
  role text not null default 'user' check (role in ('admin', 'user')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  constraint app_users_email_lowercase check (email = lower(email))
);

create index if not exists projects_scan_id_idx on public.projects(scan_id);
create index if not exists projects_country_status_idx on public.projects(country, status);
create index if not exists scan_projects_scan_id_idx on public.scan_projects(scan_id);
create index if not exists scan_projects_project_id_idx on public.scan_projects(project_id);
create index if not exists app_users_auth_user_id_idx on public.app_users(auth_user_id);

alter table public.scans enable row level security;
alter table public.projects enable row level security;
alter table public.scan_projects enable row level security;
alter table public.contact_enrichments enable row level security;
alter table public.pvh_contacts enable row level security;
alter table public.epbc_projects enable row level security;
alter table public.access_tokens enable row level security;
alter table public.app_users enable row level security;

comment on table public.access_tokens is 'Legacy Replit access-token data retained for migration/rollback verification only.';
comment on table public.app_users is 'USST authorization allowlist layered on Supabase Auth. API access requires active=true.';
