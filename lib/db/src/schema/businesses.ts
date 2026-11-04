import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const businessesTable = pgTable("businesses", {
  id: serial("id").primaryKey(),
  businessName: text("business_name").notNull(),
  businessHours: text("business_hours").notNull().default("Mon-Fri 09:00-17:00"),
  timeZone: text("time_zone").notNull().default("America/New_York"),
  agentName: text("agent_name"),
  clerkUserId: text("clerk_user_id"),
  ownerEmail: text("owner_email"),
  // Null preserves existing businesses; only newly opted-in accounts are gated.
  chosenPlan: text("chosen_plan"),
  isInternal: boolean("is_internal").notNull().default(false),
  billingMode: text("billing_mode", { enum: ["manual", "square", "stripe"] }).notNull().default("manual"),
  startupAgeMonths: integer("startup_age_months"),
  manualPaymentState: text("manual_payment_state"),
  firstInvoicePaidAt: timestamp("first_invoice_paid_at", { withTimezone: true }),
  accountStatus: text("account_status", { enum: ["active", "suspended"] }).notNull().default("active"),
  accountStatusReason: text("account_status_reason"),
  accountStatusUpdatedAt: timestamp("account_status_updated_at", { withTimezone: true }),
  forwardingTestRequestedAt: timestamp("forwarding_test_requested_at", { withTimezone: true }),
  ownerPhone: text("owner_phone"),
  smsAlertsConsent: boolean("sms_alerts_consent").notNull().default(false),
  smsAlertsConsentAt: timestamp("sms_alerts_consent_at", { withTimezone: true }),
  leadAlertsEnabled: boolean("lead_alerts_enabled").notNull().default(true),
  retellPhoneNumber: text("retell_phone_number"),
  fallbackPhoneNumber: text("fallback_phone_number"),
  // Keep the index column-only: Publish can truncate comma-containing index expressions.
  retellPhoneNormalized: text("retell_phone_normalized").generatedAlwaysAs(
    sql`NULLIF(regexp_replace(retell_phone_number, '[^0-9]', '', 'g'), '')`,
  ),
  retellAgentId: text("retell_agent_id"),
  isSample: boolean("is_sample").notNull().default(false),
  provisioningState: text("provisioning_state").notNull().default("pending"),
  serviceArea: text("service_area"),
  businessType: text("business_type"),
  servicesOffered: text("services_offered"),
  majorIssueExamples: text("major_issue_examples"),
  personalityToneDescription: text("personality_tone_description"),
  servicesNotOffered: text("services_not_offered"),
  // Owner-reviewed notes only; deliberately excluded from Retell intake variables.
  otherPolicies: text("other_policies"),
  pricingPolicy: text("pricing_policy"),
  financingPolicy: text("financing_policy"),
  brandsWorkedWith: text("brands_worked_with"),
  typicalResponseTimeCommitment: text("typical_response_time_commitment"),
  warrantyInfo: text("warranty_info"),
  maintenancePlanOfferings: text("maintenance_plan_offerings"),
  credentialsCertifications: text("credentials_certifications"),
  ownerAvailability: text("owner_availability"),
  emergencyContactInfo: text("emergency_contact_info"),
  emergencyAvailable: boolean("emergency_available"),
  emergencyEscalationPhone: text("emergency_escalation_phone"),
  aiPromisePolicy: text("ai_promise_policy"),
  managedReportsEnabled: boolean("managed_reports_enabled").notNull().default(false),
  businessWebsiteUrl: text("business_website_url"),
  websiteEnrichmentAttemptedAt: timestamp("website_enrichment_attempted_at", { withTimezone: true }),
  websiteEnrichmentSources: jsonb("website_enrichment_sources")
    .$type<Record<string, string>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  agreementsAcceptedAt: timestamp("agreements_accepted_at", { withTimezone: true }),
  agreementsAcceptedVersion: text("agreements_accepted_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("businesses_internal_billing_check", sql`NOT ${table.isInternal} OR (${table.chosenPlan} IS NULL AND ${table.billingMode} = 'manual' AND ${table.manualPaymentState} IS NULL AND ${table.firstInvoicePaidAt} IS NULL AND NOT ${table.isSample})`),
  check("businesses_billing_mode_check", sql`${table.billingMode} IN ('manual','square','stripe')`),
  uniqueIndex("businesses_clerk_user_id_unique").on(table.clerkUserId),
  uniqueIndex("businesses_phone_normalized_unique")
    .on(table.retellPhoneNormalized),
]);

export type Business = typeof businessesTable.$inferSelect;
export type NewBusiness = typeof businessesTable.$inferInsert;