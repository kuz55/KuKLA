import { z } from 'zod';

// Each field must be supplied: null means explicitly unknown, not an empty
// string. No PII is logged or included in validation errors by this module.
const knownOrUnknown = z.string().trim().min(1).nullable();

export const initialReportInputSchema = z.object({
  applicantName: knownOrUnknown,
  applicantContact: knownOrUnknown,
  missingPersonName: knownOrUnknown,
  lastSeenTime: knownOrUnknown,
  lastSeenPlace: knownOrUnknown,
  situation: knownOrUnknown,
}).strict();

export type InitialReportInput = z.input<typeof initialReportInputSchema>;
export type InitialReport = z.output<typeof initialReportInputSchema> & {
  receivedAt: string;
};

// Internal domain preparation only. It is not a public endpoint, authorization
// check, persistence layer, handoff, or SMS trigger. The server supplies time;
// caller-supplied timestamps are rejected by the strict input schema.
export function prepareInitialReport(input: unknown, receivedAt: Date): InitialReport {
  const fields = initialReportInputSchema.parse(input);
  if (!Number.isFinite(receivedAt.getTime())) {
    throw new Error('invalid receipt time');
  }
  return { ...fields, receivedAt: receivedAt.toISOString() };
}
