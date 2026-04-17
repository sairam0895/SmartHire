import { pgTable, text, serial, timestamp, integer, real, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const interviewsTable = pgTable("interviews", {
  id: serial("id").primaryKey(),
  recruiterName: text("recruiter_name").notNull(),
  candidateName: text("candidate_name").notNull(),
  candidateEmail: text("candidate_email").notNull(),
  jobTitle: text("job_title").notNull(),
  jobDescription: text("job_description").notNull(),
  status: text("status").notNull().default("pending"),
  overallScore: real("overall_score"),
  verdict: text("verdict"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  duration: integer("duration"),
  llmUsed: text("llm_used"),
  source: text("source").default("web"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes"),
  timezone: varchar("timezone", { length: 100 }),
  recordingKey: varchar("recording_key", { length: 500 }),
  recordingDurationSeconds: integer("recording_duration_seconds"),
});

export const insertInterviewSchema = createInsertSchema(interviewsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertInterview = z.infer<typeof insertInterviewSchema>;
export type Interview = typeof interviewsTable.$inferSelect;
