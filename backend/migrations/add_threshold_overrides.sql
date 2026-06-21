alter table "PROJECTS"
  add column if not exists threshold_mode text not null default 'dynamic',
  add column if not exists threshold_latency_ms float,
  add column if not exists threshold_tokens float,
  add column if not exists threshold_cost float;
