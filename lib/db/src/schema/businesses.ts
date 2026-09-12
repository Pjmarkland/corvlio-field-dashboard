import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const businessesTable = pgTable("businesses", {
  id: serial("id").primaryKey(),
  businessName: text("business_name").notNull(),
  retellPhoneNumber: text("retell_phone_number").notNull(),
  retellAgentId: text("retell_agent_id").notNull(),
  serviceArea: text("service_area"),
  personalityToneDescription: text("personality_tone_description"),
  servicesNotOffered: text("services_not_offered"),
  pricingPolicy: text("pricing_policy"),
  financingPolicy: text("financing_policy"),
  brandsWorkedWith: text("brands_worked_with"),
  typicalResponseTimeCommitment: text("typical_response_time_commitment"),
  warrantyInfo: text("warranty_info"),
  maintenancePlanOfferings: text("maintenance_plan_offerings"),
  credentialsCertifications: text("credentials_certifications"),
  ownerAvailability: text("owner_availability"),
  emergencyContactInfo: text("emergency_contact_info"),
  agreementsAcceptedAt: timestamp("agreements_accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Business = typeof businessesTable.$inferSelect;
export type NewBusiness = typeof businessesTable.$inferInsert;