-- MANUAL PRODUCTION DATA CLEANUP ONLY. Agent must NOT execute this file.
-- Not a migration, app hook, startup job, or Retell action. No HTTP/provider calls.
-- DEFAULT: PREVIEW ONLY; it reads and reports, but changes no table data.
-- Run this ENTIRE file as ONE batch in the PRODUCTION SQL runner.
-- Do not add transaction BEGIN/COMMIT: the console supplies the transaction.
-- The BEGIN inside DO below is a procedural block, NOT a transaction command.
--
-- Edit ONLY confirmation below, and only after reviewing a matching preview.
-- The only SET target is retell_phone_number. PostgreSQL also automatically
-- recalculates the existing stored generated retell_phone_normalized to NULL.
-- The apply phrase explicitly acknowledges this unavoidable generated effect.
-- Every other business field, including updated_at, must remain identical.
-- No other table, leads, sequences, or schema are changed by this file.
-- Already-NULL, missing, changed, duplicate, or partially cleared targets refuse
-- the WHOLE apply; there is no partial update or automatic re-provisioning.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $clear_released_phones$
DECLARE
  -- ONLY EDITABLE INPUT. Keep this default for the first, preview-only run.
  confirmation text := 'PREVIEW ONLY';
  required_confirmation constant text :=
    'PRODUCTION: CLEAR RELEASED PHONES 4-11; ACCEPT GENERATED NORMALIZATION';
  targets constant jsonb := $targets$[
    {"id":4,"expected_phone":"+15044749596"},
    {"id":5,"expected_phone":"+15717091218"},
    {"id":6,"expected_phone":"+19363031397"},
    {"id":7,"expected_phone":"+17626001677"},
    {"id":8,"expected_phone":"+17753679736"},
    {"id":9,"expected_phone":"+16205089615"},
    {"id":10,"expected_phone":"+19144514613"},
    {"id":11,"expected_phone":"+15167249532"}
  ]$targets$::jsonb;
  applying boolean := confirmation = required_confirmation;
  business_oid oid := to_regclass('public.businesses');
  blockers text[] := ARRAY[]::text[];
  preview_rows jsonb;
  before_businesses jsonb;
  expected_after jsonb;
  after_businesses jsonb;
  changed_ids integer[];
  target record;
  review_result jsonb;
BEGIN
  IF confirmation IS NULL OR confirmation NOT IN ('PREVIEW ONLY', required_confirmation) THEN
    RAISE EXCEPTION 'Unknown confirmation. Restore PREVIEW ONLY or use the exact reviewed apply phrase.';
  END IF;
  IF business_oid IS NULL THEN
    RAISE EXCEPTION 'REFUSED: public.businesses does not exist. Verify the production database.';
  END IF;

  -- Prevent another writer from changing any checked row between validation
  -- and update. Preview does not take this write-blocking lock.
  IF applying THEN
    LOCK TABLE ONLY public.businesses IN SHARE ROW EXCLUSIVE MODE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = business_oid AND relkind = 'r'
      AND NOT relrowsecurity AND NOT relforcerowsecurity
  ) THEN
    blockers := array_append(blockers, 'Unexpected table kind or row-level security; full-row preservation cannot be assured.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_inherits
    WHERE inhparent = business_oid OR inhrelid = business_oid
  ) THEN
    blockers := array_append(blockers, 'Business table inheritance/partitioning is unexpected; re-review.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = business_oid AND NOT tgisinternal
  ) THEN
    blockers := array_append(blockers, 'Business table has user triggers, even if disabled; additional changes cannot be ruled out.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_rewrite WHERE ev_class = business_oid
  ) THEN
    blockers := array_append(blockers, 'Business table has rewrite rules; additional changes cannot be ruled out.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_attrdef d
      ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = business_oid AND NOT a.attisdropped
      AND a.attname = 'retell_phone_normalized' AND a.attgenerated = 's'
      AND pg_get_expr(d.adbin, d.adrelid) =
        $expression$NULLIF(regexp_replace(retell_phone_number, '[^0-9]'::text, ''::text, 'g'::text), ''::text)$expression$
  ) THEN
    blockers := array_append(blockers, 'The existing stored phone-normalization expression differs from the reviewed schema.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = business_oid AND NOT attisdropped
      AND attgenerated <> '' AND attname <> 'retell_phone_normalized'
  ) THEN
    blockers := array_append(blockers, 'Additional generated business columns exist; re-review their effects.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.contype = 'f' AND c.confrelid = business_oid
      AND c.confkey && ARRAY(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = business_oid AND NOT attisdropped
          AND attname IN ('retell_phone_number', 'retell_phone_normalized')
      )::smallint[]
  ) THEN
    blockers := array_append(blockers, 'A foreign key references a changed phone field; effects on other tables require review.');
  END IF;

  -- These protected rows must exist. Never rely on owner email to select rows.
  IF (SELECT count(*) FROM ONLY public.businesses WHERE id IN (1, 2, 3, 12)) <> 4 THEN
    blockers := array_append(blockers, 'One or more protected business rows 1, 2, 3, 12 are missing.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ONLY public.businesses
    WHERE id = 12 AND business_name COLLATE pg_catalog."C" = 'Corvlio'
      AND retell_phone_number COLLATE pg_catalog."C" = '+16624994839'
  ) THEN
    blockers := array_append(blockers, 'Protected Corvlio row 12 does not exactly retain Corvlio / +16624994839.');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', t.id,
    'business_name', b.business_name,
    'expected_phone', t.expected_phone,
    'current_phone', b.retell_phone_number,
    'proposed_phone', NULL,
    'current_generated_normalization', to_jsonb(b)->>'retell_phone_normalized',
    'proposed_generated_normalization', NULL,
    'status', CASE
      WHEN b.id IS NULL THEN 'MISSING ROW - REFUSED'
      WHEN b.retell_phone_number IS NULL THEN 'ALREADY NULL - REFUSED'
      WHEN b.retell_phone_number COLLATE pg_catalog."C" IS DISTINCT FROM
        t.expected_phone COLLATE pg_catalog."C" THEN 'NUMBER MISMATCH - REFUSED'
      ELSE 'MATCH - WOULD CLEAR TO NULL'
    END
  ) ORDER BY t.id) INTO preview_rows
  FROM jsonb_to_recordset(targets) AS t(id integer, expected_phone text)
  LEFT JOIN ONLY public.businesses b ON b.id = t.id;

  FOR target IN
    SELECT t.id, t.expected_phone, b.id AS found_id, b.retell_phone_number
    FROM jsonb_to_recordset(targets) AS t(id integer, expected_phone text)
    LEFT JOIN ONLY public.businesses b ON b.id = t.id
    ORDER BY t.id
  LOOP
    IF target.found_id IS NULL OR
      target.retell_phone_number COLLATE pg_catalog."C" IS DISTINCT FROM
      target.expected_phone COLLATE pg_catalog."C" THEN
      blockers := array_append(blockers, format(
        'Business %s: expected %s; found %s. No partial apply is allowed.',
        target.id, target.expected_phone,
        CASE WHEN target.found_id IS NULL THEN 'MISSING ROW'
          ELSE coalesce(target.retell_phone_number, 'NULL') END
      ));
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM ONLY public.businesses b
    JOIN jsonb_to_recordset(targets) AS t(id integer, expected_phone text)
      ON regexp_replace(b.retell_phone_number, '[^0-9]', '', 'g') =
         regexp_replace(t.expected_phone, '[^0-9]', '', 'g')
    WHERE b.id <> t.id
  ) THEN
    blockers := array_append(blockers, 'A released number is also mapped to a different business ID; refusing ambiguous state.');
  END IF;

  review_result := jsonb_build_object(
    'mode', CASE WHEN applying THEN 'apply' ELSE 'preview' END,
    'eligible', cardinality(blockers) = 0,
    'blockers', to_jsonb(blockers),
    'rows', preview_rows,
    'required_confirmation', required_confirmation,
    'only_explicit_set_column', 'retell_phone_number',
    'automatic_generated_effect', 'retell_phone_normalized becomes NULL for the same eight rows',
    'protected_ids', jsonb_build_array(1, 2, 3, 12),
    'updated_at_changed', false,
    'other_tables_changed', 0,
    'retell_requests', 0,
    'rows_updated', 0,
    'database_actor', session_user,
    'transaction_time', transaction_timestamp()
  );

  IF applying THEN
    IF cardinality(blockers) > 0 THEN
      RAISE EXCEPTION 'CLEANUP REFUSED: %', array_to_string(blockers, '; ');
    END IF;

    -- Snapshot EVERY business row so post-checks protect all fields, IDs 1-3
    -- and 12, and any new/other businesses, not just the intended eight rows.
    SELECT coalesce(jsonb_object_agg(b.id::text, to_jsonb(b)), '{}'::jsonb)
      INTO before_businesses FROM ONLY public.businesses b;
    expected_after := before_businesses;
    FOR target IN SELECT * FROM jsonb_to_recordset(targets) AS t(id integer, expected_phone text)
    LOOP
      expected_after := jsonb_set(expected_after,
        ARRAY[target.id::text, 'retell_phone_number'], 'null'::jsonb, false);
      expected_after := jsonb_set(expected_after,
        ARRAY[target.id::text, 'retell_phone_normalized'], 'null'::jsonb, false);
    END LOOP;

    -- The ONE data-writing statement. Every row must match BOTH ID and number.
    WITH expected AS (
      SELECT * FROM jsonb_to_recordset(targets) AS t(id integer, expected_phone text)
    ), changed AS (
      UPDATE ONLY public.businesses AS b
      SET retell_phone_number = NULL
      FROM expected AS t
      WHERE b.id = t.id
        AND b.id IN (4, 5, 6, 7, 8, 9, 10, 11)
        AND b.id NOT IN (1, 2, 3, 12)
        AND b.retell_phone_number COLLATE pg_catalog."C" = t.expected_phone COLLATE pg_catalog."C"
      RETURNING b.id
    )
    SELECT array_agg(id ORDER BY id) INTO changed_ids FROM changed;
    IF changed_ids IS DISTINCT FROM ARRAY[4, 5, 6, 7, 8, 9, 10, 11] THEN
      RAISE EXCEPTION 'CLEANUP REFUSED: updated ID set differs from the exact eight reviewed rows; rolling back.';
    END IF;

    SELECT coalesce(jsonb_object_agg(b.id::text, to_jsonb(b)), '{}'::jsonb)
      INTO after_businesses FROM ONLY public.businesses b;
    IF after_businesses IS DISTINCT FROM expected_after THEN
      RAISE EXCEPTION 'CLEANUP REFUSED: another row/column changed or a target was not cleared; rolling back.';
    END IF;
    review_result := review_result || jsonb_build_object(
      'rows_updated', 8,
      'updated_ids', to_jsonb(changed_ids),
      'preservation_verified', true
    );
  END IF;
  PERFORM set_config('corvlio_recovery.clear_released_phones', review_result::text, true);
END
$clear_released_phones$;

-- Per-row preview (pre-change values are intentionally retained in apply output).
SELECT r.*
FROM jsonb_to_recordset(
  current_setting('corvlio_recovery.clear_released_phones')::jsonb->'rows'
) AS r(
  id integer, business_name text, expected_phone text, current_phone text,
  proposed_phone text, current_generated_normalization text,
  proposed_generated_normalization text, status text
)
ORDER BY r.id;

-- Review this summary as well: eligible must be true and blockers must be [].
SELECT current_setting('corvlio_recovery.clear_released_phones')::jsonb AS recovery_review_result;
