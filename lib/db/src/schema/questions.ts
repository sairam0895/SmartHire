import { pgTable, text, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { interviewsTable } from "./interviews";

export const questionsTable = pgTable("questions", {
  id: serial("id").primaryKey(),
  interviewId: integer("interview_id").notNull().references(() => interviewsTable.id),
  questionIndex: integer("question_index").notNull(),
  questionText: text("question_text").notNull(),
  questionType: text("question_type").notNull().default("technical"),
});

export const insertQuestionSchema = createInsertSchema(questionsTable).omit({
  id: true,
});
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questionsTable.$inferSelect;
