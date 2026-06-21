create table "USAGE" (
  id            bigserial primary key,
  project_id    int references "PROJECTS"(id) on delete cascade,
  run_id        text,
  feature       text        not null,
  model         text        not null,
  input_tokens  int         not null default 0,
  output_tokens int         not null default 0,
  cost_usd      float       not null default 0,
  created_at    timestamptz not null default now()
);
