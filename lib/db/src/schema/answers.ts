import { pgTable, text, serial, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { questionsTable } from "./questions";
import { interviewsTable } from "./interviews";

export const answersTable = pgTable("answers", {
  id: serial("id").primaryKey(),
  questionId: integer("question_id").notNull().references(() => questionsTable.id),
  interviewId: integer("interview_id").notNull().references(() => interviewsTable.id),
  questionIndex: integer("question_index").notNull(),
  answerText: text("answer_text").notNull(),
  score: real("score"),
  feedback: text("feedback"),
  confidenceScore: real("confidence_score"),
  fillerWordCount: integer("filler_word_count"),
  pauseCount: integer("pause_count"),
  speechDurationSeconds: integer("speech_duration_seconds"),
});

export const insertAnswerSchema = createInsertSchema(answersTable).omit({
  id: true,
});
export type InsertAnswer = z.infer<typeof insertAnswerSchema>;
export type Answer = typeof answersTable.$inferSelect;
