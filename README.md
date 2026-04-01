# LexAI Legal Intake Agent

A 6-phase conversational AI agent for criminal and civil legal intake.
Collects structured case information through natural conversation, provides general legal
information, recommends attorney referrals, and surfaces a scored case summary to the
Litmetrics lawyer dashboard.

---

## Features

- **6 intake phases**: Intake → Situation → Insurance/Financial → Witness & Evidence → Guidance → Wrap-up
- **Criminal and civil** issue coverage across all 50 US states (national)
- **Voice + chat** dual mode (Deepgram STT + ElevenLabs TTS)
- **4 Litmetrics dimensions**: Liability score, Case strength, Settlement likelihood, Statute of limitations flag
- **Emergency bypass**: Skips directly to guidance for urgent/emergency situations
- **Evidence upload**: Photos and video with AI visual analysis (OpenAI vision)
- **Privacy-safe**: SSN, DOB, and financial account numbers are blocked at schema, orchestrator, and prompt levels

---

## Architecture — 5-node pipeline

```
User message
     │
     ▼
Node 1 ─ Analyzer Prompt Creator    src/prompts/analyzer_prompt_creator.ts
     │    Assembles extraction prompt from phase instructions + history
     ▼
Node 2 ─ Analyzer LLM               OpenAI GPT-4o-mini (json_object mode)
     │    Extracts structured JSON fields from user message
     ▼
Node 3 ─ Orchestrator               src/orchestrator.ts  (zero LLM calls)
     │    Merges fields, computes risk flags, evaluates phase transitions
     ▼
Node 4 ─ Speaker Prompt Creator     src/prompts/speaker_prompt_creator.ts
     │    Assembles reply prompt from phase personality + collected facts
     ▼
Node 5 ─ Speaker LLM                OpenAI GPT-4o-mini (text mode)
          Generates natural language reply
```

---

## File structure

```
lexai/
├── state/
│   └── schema.ts                  State interface, initialState(), helper functions
├── config/
│   └── phase_registry.ts          Phase transition rules and turn limits
├── src/
│   ├── orchestrator.ts            Deterministic merge + scoring (Node 3)
│   ├── pipeline.ts                Express server — wires all nodes + REST API
│   ├── error_recovery.ts          Fallbacks for all failure modes
│   ├── test.ts                    5-layer test suite
│   └── prompts/
│       ├── analyzer_prompt_creator.ts
│       ├── speaker_prompt_creator.ts
│       └── summary_prompt_creator.ts
├── phases/
│   ├── intake/
│   │   ├── analyzer.md            Extraction fields + rules for intake phase
│   │   └── speaker.md             Personality + strategy for intake phase
│   ├── situation/
│   ├── insurance/
│   ├── witnesses/
│   ├── guidance/
│   └── wrapup/
├── prompts/
│   ├── analyzer_template.md       Reference: assembled analyzer prompt structure
│   ├── speaker_template.md        Reference: assembled speaker prompt structure
│   └── summary_template.md        Reference: summarisation prompt structure
├── data/                          SQLite database (auto-created)
├── uploads/                       Evidence file storage (auto-created)
├── .env.example                   Environment variable template
├── package.json
└── tsconfig.json
```

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

### 3. Run unit tests (no API key needed for layers 1–3)

```bash
npm run test:unit
```

### 4. Start the development server

```bash
npm run dev
```

### 5. Run end-to-end tests (requires running server + API key)

```bash
# In a second terminal:
npm run test:e2e
```

---

## REST API

### Create session
```
POST /session
Body: { "voiceMode": "chat" | "voice" }  (optional, defaults to "chat")
Returns: { sessionId, currentPhase, voiceMode, createdAt }
```

### Send message
```
POST /chat
Body: { "sessionId": "uuid", "message": "user text" }
Returns: { reply, currentPhase, turnCount, riskFlags, sessionId }
```

### Upload evidence
```
POST /upload/:sessionId
Body: multipart/form-data with field "file" (image or video, max 50 MB)
Returns: { fileId, originalName, description, uploadedAt }
```

### Get session (Litmetrics payload)
```
GET /session/:sessionId
Returns: full state including transcript, scores, risk flags, extracted facts
```

### List all sessions
```
GET /sessions
Returns: array of session summaries for the Litmetrics dashboard
```

### Voice: transcribe audio
```
POST /voice/transcribe
Body: multipart/form-data with field "audio" + "sessionId"
Returns: { transcript } or { transcript: "", fallback: "message" }
Requires: DEEPGRAM_API_KEY
```

### Voice: synthesise speech
```
POST /voice/synthesise
Body: { "text": "...", "sessionId": "uuid" }
Returns: audio/mpeg stream
Requires: ELEVENLABS_API_KEY
```

---

## Phase overview

| Phase | Label | Max turns | Transition condition |
|---|---|---|---|
| intake | Initial intake | 6 | issueType + jurisdiction + urgency |
| situation | Your situation | 8 | summary + parties + timeline + clientRole |
| insurance | Insurance & finances | 6 | coverageType + canAffordAttorney |
| witnesses | Witnesses & evidence | 8 | evidence/witness + policeReportFiled |
| guidance | Legal guidance | 10 | userSatisfied or referralAccepted |
| wrapup | Wrapping up | 4 | disclaimerInjected |

Emergency bypass: if `urgencyLevel === "emergency"` in intake/situation/insurance/witnesses,
the agent skips directly to guidance on the next turn.

---

## Litmetrics scores

All scores are 0–100 heuristic values computed once on wrapup entry.

| Dimension | Notes |
|---|---|
| `liabilityScore` | Legal complexity and exposure |
| `caseStrengthScore` | Evidence quality, witnesses, documents |
| `settlementLikelihoodScore` | Civil cases only; 0 for criminal |
| `statuteOfLimitationsFlag` | "ok" / "warning" / "critical" |

Replace `computeScores()` in `src/orchestrator.ts` with an LLM call for production scoring.

---

## Adding a new phase

1. Add the phase name to the `Phase` union in `state/schema.ts`
2. Add a `PhaseConfig` entry in `config/phase_registry.ts`
3. Update the `nextPhase` of the preceding phase
4. Write `phases/{name}/analyzer.md` and `speaker.md`
5. Add any new state fields to `schema.ts`
6. Add merge logic to `src/orchestrator.ts`
7. Add the phase to `copyMergedFields()` in `orchestrator.ts`
8. Add unit tests to `src/test.ts` Layer 2

---

## Privacy and compliance notes

- Social Security Numbers (SSN), dates of birth, and financial account numbers are **never collected**.
  This is enforced at three levels: schema omission, orchestrator SSN guard, and analyzer prompt rules.
- All user-facing error messages are client-safe — no stack traces or technical details are exposed.
- The legal disclaimer is **mandatory** in every session — the wrapup phase cannot complete without it.
- Disclaimer language should be reviewed by legal counsel before production deployment.
- Litmetrics scores are heuristic MVP values — they should not be used as legal assessments.
