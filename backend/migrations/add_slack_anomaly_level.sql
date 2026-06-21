alter table "PROJECTS"
  add column if not exists slack_anomaly_level text not null default 'critical';
