CREATE TABLE accounts (
  id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL, role text NOT NULL CHECK (role IN
  ('admin','coordinator','pi','guide','department','lab','management','feedback','scholar')),
  department_id uuid, active boolean NOT NULL DEFAULT true
);
CREATE TABLE departments (id uuid PRIMARY KEY, name text UNIQUE NOT NULL);
ALTER TABLE accounts ADD FOREIGN KEY (department_id) REFERENCES departments;
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts,
  expires_at timestamptz NOT NULL
);
CREATE TABLE login_limits (email text PRIMARY KEY, attempts integer NOT NULL, since timestamptz NOT NULL);
CREATE TABLE settings (key text PRIMARY KEY, data jsonb NOT NULL, version integer NOT NULL DEFAULT 1);
CREATE TABLE studies (
  id text PRIMARY KEY, title text NOT NULL, version integer NOT NULL DEFAULT 1, data jsonb NOT NULL
);
CREATE INDEX study_title_index ON studies (lower(title));
CREATE SEQUENCE study_number;
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, scope text NOT NULL,
  subject text NOT NULL, actor uuid REFERENCES accounts, kind text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL
);
CREATE INDEX events_subject_index ON events (scope,subject,id);
CREATE TABLE documents (
  id uuid PRIMARY KEY, study_id text NOT NULL REFERENCES studies, slot text NOT NULL,
  version integer NOT NULL, filename text NOT NULL, mime text NOT NULL,
  bytes bytea, link text, actor uuid NOT NULL REFERENCES accounts,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id,slot,version), CHECK ((bytes IS NULL) <> (link IS NULL))
);
CREATE TABLE reviews (
  id uuid PRIMARY KEY, series_id uuid NOT NULL, version integer NOT NULL,
  revision integer NOT NULL DEFAULT 1, actor uuid NOT NULL REFERENCES accounts,
  data jsonb NOT NULL, frozen_at timestamptz, UNIQUE(series_id,version)
);
CREATE TABLE campaigns (id uuid PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE feedback_responses (
  id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns,
  study_id text REFERENCES studies, named_account uuid REFERENCES accounts,
  submitted_day date NOT NULL, data jsonb NOT NULL
);
CREATE TABLE feedback_redemptions (
  campaign_id uuid NOT NULL REFERENCES campaigns, account_id uuid NOT NULL REFERENCES accounts,
  PRIMARY KEY(campaign_id,account_id)
);
CREATE TABLE corrective_actions (
  id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns,
  response_id uuid REFERENCES feedback_responses, revision integer NOT NULL DEFAULT 1,
  data jsonb NOT NULL
);
CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable record'; END $$;
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER immutable_documents BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION preserve_frozen_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL THEN RAISE EXCEPTION 'Frozen review'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_frozen_reviews BEFORE UPDATE OR DELETE ON reviews FOR EACH ROW EXECUTE FUNCTION preserve_frozen_review();
