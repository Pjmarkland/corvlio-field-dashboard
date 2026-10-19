-- Additive, development-only. No existing business opts into Square.
BEGIN;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'manual';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='businesses'::regclass AND conname='businesses_billing_mode_check'
  ) THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_billing_mode_check
      CHECK (billing_mode IN ('manual','square'));
  END IF;
END $$;
COMMIT;
