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
- **AI**: OpenAI GPT via Replit AI Integrations (no API key needed)
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

- `/` — Recruiter Dashboard with interview list and stats
- `/create` — Create interview (paste JD, AI generates questions)
- `/interview/:id` — Candidate interview page (one question at a time)
- `/scorecard/:id` — Scorecard with scores, verdict, Q&A transcript, PDF export

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## AI Integration

Uses Replit AI Integrations for OpenAI access (billed to Replit credits, no user API key required).
- Question generation: `gpt-5.2` — generates 7 targeted questions from job descriptions
- Answer evaluation: `gpt-5.2` — scores answers across 4 dimensions and produces a verdict

## Database Schema

- `interviews` — main interview records with status, verdict, scores
- `questions` — AI-generated questions per interview
- `answers` — candidate answers with per-answer AI scores
- `scorecards` — AI-generated evaluation with all score dimensions

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
