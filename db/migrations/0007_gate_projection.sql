BEGIN;

CREATE TABLE IF NOT EXISTS publication_gate_result (
  gate_result_id text PRIMARY KEY,
  gate_name text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  state text NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz
);

CREATE TABLE IF NOT EXISTS page_projection_state (
  projection_id text PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  projection_type text NOT NULL,
  canonical_version integer,
  gate_state text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  rendered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id, projection_type)
);

COMMIT;
