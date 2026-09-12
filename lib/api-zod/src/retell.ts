import { z } from "zod";

const retellCallAnalysisSchema = z
  .object({
    custom_analysis_data: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();

export const RetellCallSchema = z
  .object({
    to_number: z.string().optional(),
    from_number: z.string().optional(),
    call_analysis: retellCallAnalysisSchema.optional(),
  })
  .passthrough();

export const RetellPreCallWebhookBody = z
  .object({
    call: RetellCallSchema.optional(),
    call_inbound: RetellCallSchema.optional(),
    to_number: z.string().optional(),
  })
  .passthrough();

export const RetellPostCallWebhookBody = z
  .object({
    event: z.string().optional(),
    call: RetellCallSchema.optional(),
  })
  .passthrough();

export type RetellCall = z.infer<typeof RetellCallSchema>;
export type RetellPreCallWebhook = z.infer<typeof RetellPreCallWebhookBody>;
export type RetellPostCallWebhook = z.infer<typeof RetellPostCallWebhookBody>;