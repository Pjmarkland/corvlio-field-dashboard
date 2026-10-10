-- Additive only. Apply to DEVELOPMENT only before enabling billing.
-- No updates to businesses, leads, Retell, existing schemas or production data.
CREATE TABLE IF NOT EXISTS billing_accounts (
  business_id integer PRIMARY KEY REFERENCES businesses(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  state jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_customer_unique ON billing_accounts(stripe_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscription_unique ON billing_accounts(stripe_subscription_id);
CREATE TABLE IF NOT EXISTS billing_events (
  id text PRIMARY KEY,
  business_id integer REFERENCES businesses(id),
  type text NOT NULL,
  actor text,
  detail text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_notices (
  id text PRIMARY KEY,
  business_id integer NOT NULL REFERENCES businesses(id),
  audience text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  delivery jsonb NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
