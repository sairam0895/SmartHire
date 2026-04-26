import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { interviewsTable } from "./interviews";

export const scorecardsTable = pgTable("scorecards", {
  id: serial("id").primaryKey(),
  interviewId: integer("interview_id").notNull().references(() => interviewsTable.id),
  technicalScore: real("technical_score").notNull(),
  communicationScore: real("communication_score").notNull(),
  problemSolvingScore: real("problem_solving_score").notNull(),
  roleRelevanceScore: real("role_relevance_score").notNull(),
  speechConfidenceScore: real("speech_confidence_score"),
  culturalFitScore: real("cultural_fit_score"),
  overallScore: real("overall_score").notNull(),
  verdict: text("verdict").notNull(),
  strengths: text("strengths").array().notNull(),
  improvements: text("improvements").array().notNull(),
  summary: text("summary").notNull(),
  recruiterNote: text("recruiter_note").notNull(),
  proctoringReport: text("proctoring_report"),
  jdAlignmentReport: text("jd_alignment_report"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScorecardSchema = createInsertSchema(scorecardsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertScorecard = z.infer<typeof insertScorecardSchema>;
export type Scorecard = typeof scorecardsTable.$inferSelect;
