# SmartHire 🤖

AI-powered L1 screening interview platform that conducts autonomous candidate interviews via Microsoft Teams and delivers structured scorecards to recruiters.

## What It Does

SmartHire joins a Teams meeting as a bot, introduces itself to the candidate, asks role-specific questions generated from the Job Description, evaluates responses using AI, and posts a detailed scorecard directly in the Teams chat — zero human intervention required.

## Architecture

Candidate joins Teams meeting
↓
SmartHire Bot joins same meeting
↓
Bot generates questions from JD (Groq LLaMA)
↓
Bot asks questions → Candidate answers
↓
AI evaluates all responses (Groq LLaMA)
↓
Scorecard saved to PostgreSQL
↓
Recruiter sees report in Teams chat + Recruiter Portal

## Tech Stack

| Layer | Technology |
|---|---|
| Bot Framework | Microsoft Bot Framework SDK (Node.js) |
| Meeting Platform | Microsoft Teams (Graph Communications API) |
| Speech STT/TTS | Azure Speech Services (ready to connect) |
| AI / LLM | Groq — LLaMA 3.3 70B (fast, free tier) |
| Backend API | Node.js + Express + TypeScript |
| Database | PostgreSQL (Neon) via Drizzle ORM |
| Frontend | React + TypeScript + Tailwind + shadcn/ui |
| PDF Export | PDFKit |

## Project Structure

smart-hire/
├── artifacts/
│   ├── api-server/          # Express backend + Bot server
│   │   └── src/
│   │       ├── bot/
│   │       │   ├── smartHireBot.ts   # Bot brain
│   │       │   └── botServer.ts      # Bot HTTP server
│   │       ├── routes/
│   │       │   ├── interviews.ts     # Interview CRUD
│   │       │   ├── bot.ts            # Bot API endpoints
│   │       │   └── pdf.ts            # PDF export
│   │       └── lib/
│   │           └── ai.ts             # Groq question gen + evaluation
│   └── smarthire/           # React recruiter portal
├── lib/
│   ├── db/                  # Drizzle schema + migrations
│   ├── api-spec/            # OpenAPI spec
│   └── api-client-react/    # Auto-generated React Query hooks

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm
- PostgreSQL database (Neon recommended)
- Groq API key (free at console.groq.com)

### Setup

```bash
# Clone the repo
git clone https://github.com/sairam0895/SmartHire.git
cd SmartHire

# Install dependencies
pnpm install

# Configure environment
cp artifacts/api-server/.env.example artifacts/api-server/.env
# Edit .env with your credentials
```

### Environment Variables

Create `artifacts/api-server/.env`:

```env
# Database
DATABASE_URL=postgresql://...

# Server
PORT=8080
BOT_PORT=3978

# AI
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.groq.com/openai/v1
AI_INTEGRATIONS_OPENAI_API_KEY=your-groq-key

# Bot
BOT_API_KEY=your-secret-key
BOT_APP_ID=                    # From Azure IT (pending)
BOT_APP_PASSWORD=              # From Azure IT (pending)

# Default interview config
DEFAULT_RECRUITER_EMAIL=recruiter@company.com
DEFAULT_JOB_TITLE=Software Engineer
DEFAULT_JD=We are looking for a Software Engineer...
```

### Run Locally

```bash
# Terminal 1 — API + Bot server
cd artifacts/api-server
pnpm run build
pnpm run start
# API: http://localhost:8080
# Bot: http://localhost:3978

# Terminal 2 — Frontend
cd artifacts/smarthire
$env:PORT="5173"; $env:BASE_PATH="/"
pnpm run dev
# Frontend: http://localhost:5173
```

### Test the Bot

1. Download [Bot Framework Emulator](https://github.com/Microsoft/BotFramework-Emulator/releases)
2. Connect to `http://localhost:3978/api/messages`
3. Type `ready` to start an interview

## Current Status

| Feature | Status |
|---|---|
| AI question generation | ✅ Complete |
| AI evaluation + scoring | ✅ Complete |
| Bot interview flow | ✅ Complete |
| Database persistence | ✅ Complete |
| Recruiter portal | ✅ Complete |
| Scorecard UI | ✅ Complete |
| PDF export | ✅ Complete |
| Bot Emulator tested | ✅ Complete |
| Azure Bot Registration | ⏳ Pending IT access |
| Real Teams meeting | ⏳ Pending IT access |
| Azure Speech STT/TTS | ⏳ Pending IT access |
| Production deployment | ⏳ Planned |

## Team

| Name | Role |
|---|---|
| Raghavendra | Product Owner |
| Mohan | Team Lead & Architect |
| Aishwarya | Business Analyst |
| Sai Ram | Bot + AI Pipeline + QA |
| Harsha | All-rounder |
| Reddi Prasad | Technical |
| Minakshi | Frontend & Creative |

## Roadmap

- [ ] Azure Bot Registration (waiting on IT)
- [ ] Real Teams meeting integration
- [ ] Azure Speech STT/TTS for voice interviews
- [ ] Dynamic JD from meeting invite
- [ ] Production deployment on Azure
- [ ] Candidate consent screen
- [ ] Multi-language support

---

*SmartHire — Where AI Meets Talent* 🎯
