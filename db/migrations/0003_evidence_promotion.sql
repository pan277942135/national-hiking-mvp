BEGIN;

CREATE TABLE IF NOT EXISTS evidence (
  evidence_id text PRIMARY KEY,
  source_type text NOT NULL,
  publisher text,
  source_url text,
  observed_at timestamptz NOT NULL,
  source_hash text,
  raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_claim (
  claim_id text PRIMARY KEY,
  evidence_id text NOT NULL REFERENCES evidence(evidence_id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  field_key text NOT NULL,
  claim_value jsonb,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(4,3),
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE TABLE IF NOT EXISTS field_value (
  field_value_id text PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  field_key text NOT NULL,
  state field_state_enum NOT NULL,
  value jsonb,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  valid_from timestamptz,
  valid_until timestamptz,
  version integer NOT NULL CHECK (version > 0),
  is_current boolean NOT NULL DEFAULT true,
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id, field_key, version),
  CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_field_value_one_current
  ON field_value(entity_type, entity_id, field_key)
  WHERE is_current;

CREATE TABLE IF NOT EXISTS field_evidence_link (
  link_id text PRIMARY KEY,
  field_value_id text NOT NULL REFERENCES field_value(field_value_id),
  evidence_id text NOT NULL REFERENCES evidence(evidence_id),
  claim_id text REFERENCES evidence_claim(claim_id),
  UNIQUE(field_value_id, evidence_id, claim_id)
);

CREATE TABLE IF NOT EXISTS conflict_set (
  conflict_set_id text PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  field_key text NOT NULL,
  state text NOT NULL,
  members jsonb NOT NULL,
  resolution jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS dependency (
  dependency_id text PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  field_key text,
  dependency_class dependency_class_enum NOT NULL,
  state text NOT NULL,
  stop_status text NOT NULL,
  reopen_trigger text NOT NULL,
  preferred_source_class text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

COMMIT;
