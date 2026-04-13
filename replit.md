# SmartHire

## Overview

SmartHire is an AI-powered L1 interview assessment platform. Recruiters create interviews by pasting a Job Description, the AI generates tailored questions, candidates answer them via a web interface, and the AI evaluates responses to produce a structured scorecard with scores, verdict, and recommendations.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: OpenAI GPT via Replit AI Integrations (no API key needed) + Ollama fallback for question generation
- **PDF**: pdfkit (externalized from esbuild bundle)
- **Frontend**: React + Vite + Tailwind CSS

## Architecture

- `artifacts/api-server/` — Express 5 API server with interview management routes
- `artifacts/smarthire/` — React + Vite frontend at `/`
- `lib/db/` — Drizzle ORM schemas (interviews, questions, answers, scorecards)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth)
- `lib/api-client-react/` — Generated React Query hooks
- `lib/api-zod/` — Generated Zod validation schemas
- `lib/integrations-openai-ai-server/` — OpenAI client for server-side AI calls

## Key Pages

- `/` — Recruiter Dashboard with interview list, stats, filters, source/LLM columns
- `/create` — Create interview (paste JD, AI generates questions via Ollama or GPT)
- `/interview/:id` — Candidate interview page (one question at a time)
- `/scorecard/:id` — Scorecard with 5 score dimensions, speech signals panel, source badge, PDF export

## API Routes

- `GET /api/interviews` — list all interviews
- `POST /api/interviews` — create interview + generate questions
- `GET /api/interviews/:id` — get single interview
- `POST /api/interviews/:id/submit` — submit answers (with optional speech signals) + trigger evaluation
- `GET /api/interviews/:id/scorecard` — get scorecard with answers and questions
- `GET /api/interviews/stats` — stats (total, completed, pending, averageScore, verdictBreakdown)
- `GET /api/scorecard/:id/pdf` — download scorecard as PDF
- `GET /api/bot/health` — Teams bot health check (ollamaAvailable, gptAvailable)
- `POST /api/bot/submit-interview` — Teams bot endpoint (requires `x-api-key: BOT_API_KEY`)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## AI Integration

Uses Replit AI Integrations for OpenAI access (billed to Replit credits, no user API key required).

- **Question generation**: Tries Ollama (llama3) first with 3s timeout → falls back to `gpt-5.2`. Sets `llmUsed` field to "llama3+gpt" or "gpt".
- **Answer evaluation**: Always uses `gpt-5.2`. Scores across 5 dimensions (technical, communication, problemSolving, roleRelevance, speechConfidence). If speech signals provided, factors them into communication and speechConfidence scores.

## Database Schema

- `interviews` — main interview records with status, verdict, scores, `llmUsed`, `source` ("web" or "bot")
- `questions` — AI-generated questions per interview
- `answers` — candidate answers with per-answer scores + optional speech signals (confidenceScore, fillerWordCount, pauseCount, speechDurationSeconds)
- `scorecards` — AI evaluation with 5 score dimensions including `speechConfidenceScore` (nullable)

## Teams Bot Integration

The `.NET Teams bot` calls:
1. `GET /api/bot/health` — to check system readiness
2. `POST /api/bot/submit-interview` with `x-api-key: <BOT_API_KEY>` — to submit a complete Teams interview with Azure Speech signals

Set `BOT_API_KEY` environment secret to enable the bot endpoint. Without it, the endpoint returns 503.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
