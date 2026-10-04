-- MANUAL DATA RECOVERY ONLY. Not a migration, startup hook, or provisioning action.
-- Agent must NOT run this on production. Nothing invokes Retell.
-- Default is PREVIEW: no INSERT and no sequence allocation.
-- Edit ONLY the three marked inputs after independently verifying the production session.
-- Run the entire file as ONE query/transaction, not statement by statement.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $recovery$
DECLARE
  -- INPUT 1: Never use an ID just because it appears on an old email-matching row.
  target_user_id text := 'REPLACE_WITH_VERIFIED_PRODUCTION_CLERK_USER_ID';
  -- INPUT 2: Leave PREVIEW ONLY for the first run.
  confirmation text := 'PREVIEW ONLY';
  -- INPUT 3: Set only after checking the signed-in PRODUCTION user's verified primary email.
  identity_attestation text := 'NOT VERIFIED';
  required_confirmation constant text := 'INSERT CORVLIO +16624994839 FOR VERIFIED PRODUCTION USER';
  required_attestation constant text := 'PRODUCTION SESSION VERIFIED: pjmarkland08@gmail.com';
  source_user_id constant text := 'user_3K2xZZqDscJ2qct9xlf9XBp3jR5';
  -- Exact development business snapshot. ID, Clerk identity and row timestamps are NOT copied.
  payload jsonb := $snapshot${
    "business_name": "Corvlio",
    "business_hours": "Mon-Fri 09:00-17:00",
    "time_zone": "America/New_York",
    "agent_name": null,
    "owner_email": "Pjmarkland08@gmail.com",
    "owner_phone": null,
    "lead_alerts_enabled": true,
    "retell_phone_number": "+16624994839",
    "retell_agent_id": "agent_57af301bd0aa3994b83b3a2ee9",
    "is_sample": false,
    "provisioning_state": "pending",
    "service_area": "Estero/Fort Myers ",
    "business_type": "AI Receptionist",
    "major_issue_examples": "",
    "personality_tone_description": "Warm, kind, helpful",
    "services_not_offered": "",
    "pricing_policy": "",
    "financing_policy": "",
    "brands_worked_with": "",
    "typical_response_time_commitment": "Within 24 hours",
    "warranty_info": "",
    "maintenance_plan_offerings": "",
    "credentials_certifications": "",
    "owner_availability": "Anytime",
    "emergency_contact_info": "8634463029",
    "business_website_url": "Corvlio.com",
    "website_enrichment_attempted_at": "2026-09-30T11:59:53.219Z",
    "website_enrichment_sources": {"typicalResponseTimeCommitment": "https://corvlio.com/"},
    "agreements_accepted_at": "2026-09-30T11:59:53.192Z"
  }$snapshot$::jsonb;
  intended public.businesses%ROWTYPE;
  phone_row public.businesses%ROWTYPE;
  owner_row public.businesses%ROWTYPE;
  inserted_row public.businesses%ROWTYPE;
  phone_unique boolean;
  owner_unique boolean;
  blockers text[] := ARRAY[]::text[];
  already_claimed boolean := false;
  applying boolean := confirmation = required_confirmation;
  result jsonb;
BEGIN
  IF confirmation NOT IN ('PREVIEW ONLY', required_confirmation) THEN
    RAISE EXCEPTION 'Unknown confirmation; use PREVIEW ONLY or the exact reviewed confirmation phrase';
  END IF;
  -- Serialize the conflict check and INSERT against all other business writers.
  -- Readers remain available. A busy table fails quickly instead of waiting indefinitely.
  IF applying THEN
    LOCK TABLE public.businesses IN SHARE ROW EXCLUSIVE MODE;
  END IF;
  payload := payload || jsonb_build_object('clerk_user_id', target_user_id);
  SELECT * INTO intended FROM jsonb_populate_record(NULL::public.businesses, payload);
  -- Normalize even formatted numbers when looking for conflicts.
  SELECT * INTO phone_row FROM public.businesses
    WHERE regexp_replace(retell_phone_number, '[^0-9]', '', 'g') = '16624994839';
  SELECT * INTO owner_row FROM public.businesses WHERE clerk_user_id = target_user_id;
  SELECT
    EXISTS (SELECT 1 FROM pg_index i
      WHERE i.indrelid = 'public.businesses'::regclass AND i.indisunique AND i.indisvalid
        AND i.indnatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL
        AND i.indkey[0] = (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.businesses'::regclass AND attname = 'retell_phone_normalized')),
    EXISTS (SELECT 1 FROM pg_index i
      WHERE i.indrelid = 'public.businesses'::regclass AND i.indisunique AND i.indisvalid
        AND i.indnatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL
        AND i.indkey[0] = (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.businesses'::regclass AND attname = 'clerk_user_id'))
    INTO phone_unique, owner_unique;

  -- Compare only copied fields; timestamps are canonicalized by the row type.
  -- If a successful recovery is later edited, refuse rather than overwrite it.
  already_claimed := phone_row.id IS NOT NULL
    AND owner_row.id = phone_row.id
    AND (SELECT jsonb_object_agg(k, to_jsonb(phone_row)->k) FROM jsonb_object_keys(payload) k)
      = (SELECT jsonb_object_agg(k, to_jsonb(intended)->k) FROM jsonb_object_keys(payload) k);
  already_claimed := coalesce(already_claimed, false);
  blockers := array_remove(ARRAY[
    CASE WHEN target_user_id !~ '^user_[A-Za-z0-9]+$' THEN 'Verified production Clerk user ID is missing or invalid' END,
    CASE WHEN target_user_id = source_user_id THEN 'Target is the known development Clerk ID, not a verified production identity' END,
    CASE WHEN identity_attestation <> required_attestation THEN 'Production session and verified primary email have not been attested' END,
    CASE WHEN NOT phone_unique OR NOT owner_unique THEN 'Required unique phone/owner indexes are missing or invalid' END,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM pg_attribute a JOIN pg_attrdef d
        ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.businesses'::regclass
        AND a.attname = 'retell_phone_normalized' AND a.attgenerated = 's'
        AND pg_get_expr(d.adbin, d.adrelid) =
          $expression$NULLIF(regexp_replace(retell_phone_number, '[^0-9]'::text, ''::text, 'g'::text), ''::text)$expression$
    ) THEN 'Generated phone normalization rule differs from the reviewed production schema' END,
    CASE WHEN phone_row.id IS NOT NULL AND NOT already_claimed THEN 'Number already belongs to a business, or recovered settings differ; refusing any overwrite' END,
    CASE WHEN owner_row.id IS NOT NULL AND NOT already_claimed THEN 'Production login already owns a business; additive recovery cannot preserve that row and also reuse this login' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.businesses'::regclass AND NOT tgisinternal)
      THEN 'Business table now has user triggers; re-review side effects before insertion' END
  ], NULL);
  result := jsonb_build_object(
    'mode', CASE WHEN applying THEN 'apply' ELSE 'preview' END,
    'action', CASE WHEN already_claimed THEN 'already_claimed_no_write' ELSE 'insert_one_business' END,
    'eligible', cardinality(blockers) = 0,
    'blockers', to_jsonb(blockers),
    'source', jsonb_build_object('environment', 'development', 'business_id', 5,
      'snapshot_updated_at', '2026-09-30T12:00:11.486Z'),
    'copied_fields_and_target_user', payload,
    'existing_phone_business_id', phone_row.id,
    'existing_owner_business_id', owner_row.id,
    'existing_rows_modified', 0,
    'leads_copied', 0,
    'retell_requests', 0,
    'generated_fields', jsonb_build_object('id', 'new database default',
      'created_at', 'insertion time', 'updated_at', 'insertion time',
      'retell_phone_normalized', 'generated by existing database rule'),
    'database_actor', session_user,
    'transaction_time', transaction_timestamp()
  );
  IF applying THEN
    IF cardinality(blockers) > 0 THEN
      RAISE EXCEPTION 'RECOVERY BLOCKED: %', array_to_string(blockers, '; ');
    END IF;
    IF NOT already_claimed THEN
      INSERT INTO public.businesses (
        business_name, business_hours, time_zone, agent_name, clerk_user_id,
        owner_email, owner_phone, lead_alerts_enabled, retell_phone_number,
        retell_agent_id, is_sample, provisioning_state, service_area, business_type,
        major_issue_examples, personality_tone_description, services_not_offered,
        pricing_policy, financing_policy, brands_worked_with,
        typical_response_time_commitment, warranty_info, maintenance_plan_offerings,
        credentials_certifications, owner_availability, emergency_contact_info,
        business_website_url, website_enrichment_attempted_at,
        website_enrichment_sources, agreements_accepted_at
      ) VALUES (
        intended.business_name, intended.business_hours, intended.time_zone,
        intended.agent_name, intended.clerk_user_id, intended.owner_email,
        intended.owner_phone, intended.lead_alerts_enabled, intended.retell_phone_number,
        intended.retell_agent_id, intended.is_sample, intended.provisioning_state,
        intended.service_area, intended.business_type, intended.major_issue_examples,
        intended.personality_tone_description, intended.services_not_offered,
        intended.pricing_policy, intended.financing_policy, intended.brands_worked_with,
        intended.typical_response_time_commitment, intended.warranty_info,
        intended.maintenance_plan_offerings, intended.credentials_certifications,
        intended.owner_availability, intended.emergency_contact_info,
        intended.business_website_url, intended.website_enrichment_attempted_at,
        intended.website_enrichment_sources, intended.agreements_accepted_at
      ) RETURNING * INTO inserted_row;
      result := result || jsonb_build_object('inserted_business_id', inserted_row.id,
        'inserted_record', to_jsonb(inserted_row));
    ELSE
      result := result || jsonb_build_object('existing_business_id', phone_row.id);
    END IF;
  END IF;
  PERFORM set_config('corvlio_recovery.result', result::text, true);
END
$recovery$;

-- Save this result with the SQL and production identity verification as the review/audit record.
-- There is deliberately no new audit table or write to any other production table.
SELECT current_setting('corvlio_recovery.result')::jsonb AS recovery_review_result;
COMMIT;