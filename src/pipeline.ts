// =============================================================================
// src/pipeline.ts
// LexAI Legal Intake Agent — Pipeline Server
//
// Wires the 5-node pipeline into a runnable Express server.
//
// Node topology:
//   Node 1  Analyzer Prompt Creator   (analyzer_prompt_creator.ts)
//   Node 2  Analyzer LLM              (OpenAI GPT-4o-mini, json_object mode)
//   Node 3  Orchestrator              (orchestrator.ts — deterministic, no LLM)
//   Node 4  Speaker Prompt Creator    (speaker_prompt_creator.ts)
//   Node 5  Speaker LLM              (OpenAI GPT-4o-mini, text mode)
//
// REST endpoints:
//   POST   /session                   Create a new session
//   POST   /chat                      Send a message, get a reply
//   POST   /upload/:sessionId         Upload photo or video evidence
//   GET    /session/:sessionId        Retrieve full session state (Litmetrics)
//   GET    /sessions                  List all sessions (Litmetrics dashboard)
//   DELETE /session/:sessionId        Close and archive a session
//
// Voice endpoints (STT/TTS — only active when DEEPGRAM_API_KEY + ELEVENLABS_API_KEY set):
//   POST   /voice/transcribe          Audio → text (STT, returns transcript)
//   POST   /voice/synthesise          Text → audio (TTS, returns audio stream)
//
// =============================================================================

import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer from "multer";
import Database from "better-sqlite3";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import FormData from "form-data";
import fetch from "node-fetch";

import {
  initialState,
  type LegalAgentState,
  type VoiceMode,
} from "../state/schema";
import { orchestrate } from "./orchestrator";
import {
  buildAnalyzerPrompt,
  ANALYZER_LLM_CONFIG,
  parseAnalyzerResponse,
} from "./prompts/analyzer_prompt_creator";
import {
  buildSpeakerPrompt,
  getSpeakerLLMConfig,
} from "./prompts/speaker_prompt_creator";
import {
  shouldSummarise,
  buildSummaryPrompt,
  SUMMARY_LLM_CONFIG,
  parseSummaryResponse,
} from "./prompts/summary_prompt_creator";
import {
  getSpeakerFallbackReply,
  validateUploadedFile,
  getFileUploadError,
  getFileAnalysisFallbackDescription,
  getDatabaseError,
  SESSION_NOT_FOUND_RESPONSE,
  getSTTError,
  getTTSError,
  PIPELINE_ERROR,
  RATE_LIMIT_ERROR,
  logError,
  logWarn,
  logInfo,
} from "./error_recovery";

// =============================================================================
// Environment + configuration
// =============================================================================

const PORT              = parseInt(process.env.PORT ?? "3000", 10);
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY ?? "";
const DEEPGRAM_API_KEY  = process.env.DEEPGRAM_API_KEY ?? "";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM"; // default: Rachel

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const DATA_DIR    = path.resolve(process.cwd(), "data");
const DB_PATH     = path.join(DATA_DIR, "lexai.db");

if (!OPENAI_API_KEY) {
  console.error("FATAL: OPENAI_API_KEY is not set. Please add it to your .env file.");
  process.exit(1);
}

// =============================================================================
// Directory setup
// =============================================================================

for (const dir of [UPLOADS_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logInfo("[Startup]", `Created directory: ${dir}`);
  }
}

// =============================================================================
// SQLite database
// =============================================================================

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT PRIMARY KEY,
    state_json   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
`);

logInfo("[Database]", `SQLite ready at ${DB_PATH}`);

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function dbGetSession(sessionId: string): LegalAgentState | null {
  const row = db
    .prepare("SELECT state_json FROM sessions WHERE session_id = ?")
    .get(sessionId) as { state_json: string } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.state_json) as LegalAgentState;
  } catch {
    logError("[Database]", `Failed to parse state for session ${sessionId}`);
    return null;
  }
}

function dbSaveSession(state: LegalAgentState): void {
  const json = JSON.stringify(state);
  db.prepare(`
    INSERT INTO sessions (session_id, state_json, created_at, updated_at)
    VALUES (@sessionId, @json, @createdAt, @updatedAt)
    ON CONFLICT(session_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run({
    sessionId: state.sessionId,
    json,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  });
}

function dbListSessions(): Array<{
  sessionId: string;
  currentPhase: string;
  turnCount: number;
  legalIssueType: string;
  jurisdiction: string;
  urgencyLevel: string;
  riskFlags: string[];
  liabilityScore: number | null;
  caseStrengthScore: number | null;
  createdAt: string;
  updatedAt: string;
}> {
  const rows = db
    .prepare("SELECT state_json FROM sessions ORDER BY updated_at DESC")
    .all() as Array<{ state_json: string }>;

  return rows.flatMap((row) => {
    try {
      const s = JSON.parse(row.state_json) as LegalAgentState;
      return [{
        sessionId: s.sessionId,
        currentPhase: s.currentPhase,
        turnCount: s.turnCount,
        legalIssueType: s.legalIssueType,
        jurisdiction: s.jurisdiction,
        urgencyLevel: s.urgencyLevel,
        riskFlags: s.riskFlags,
        liabilityScore: s.liabilityScore,
        caseStrengthScore: s.caseStrengthScore,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }];
    } catch {
      return [];
    }
  });
}

// =============================================================================
// OpenAI client
// =============================================================================

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =============================================================================
// Multer — file upload handling
// =============================================================================

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, _file, cb) => cb(null, `${uuidv4()}-${Date.now()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 52 * 1024 * 1024 }, // slightly above our soft limit — let validation catch it
  fileFilter: (_req, file, cb) => {
    // Accept all here; validateUploadedFile() does the real check after
    cb(null, true);
  },
});

// =============================================================================
// Core pipeline: runTurn
// The single function the test suite imports as `runTurn`.
// =============================================================================

export async function runTurn(state: LegalAgentState): Promise<LegalAgentState> {
  const sessionId = state.sessionId;
  const phase     = state.currentPhase;

  // --- Node 1: Build analyzer prompt ---
  const analyzerPrompt = buildAnalyzerPrompt(state);

  // --- Node 2: Call Analyzer LLM ---
  let analyzerOutput: Record<string, unknown> = {};
  try {
    const analyzerResponse = await openai.chat.completions.create({
      ...ANALYZER_LLM_CONFIG,
      messages: [{ role: "user", content: analyzerPrompt }],
    });
    const raw = analyzerResponse.choices[0]?.message?.content ?? "";
    analyzerOutput = parseAnalyzerResponse(raw);
  } catch (err) {
    logWarn(`[Analyzer]`, `Empty output on turn ${state.turnCount} (session ${sessionId}): ${(err as Error).message}`);
    // analyzerOutput stays {} — orchestrator merges nothing, session continues
  }

  // --- Node 3: Orchestrate ---
  const updates = orchestrate(state, analyzerOutput);

  // Determine if this was a free turn (speaker fallback will be used)
  // Before we build speaker prompt, merge updates into working state
  let workingState: LegalAgentState = { ...state, ...updates };

  // --- Summarisation (if threshold reached) ---
  if (shouldSummarise(workingState)) {
    try {
      const summaryPrompt = buildSummaryPrompt(workingState);
      const summaryResponse = await openai.chat.completions.create({
        ...SUMMARY_LLM_CONFIG,
        messages: [{ role: "user", content: summaryPrompt }],
      });
      const rawSummary = summaryResponse.choices[0]?.message?.content ?? "";
      const summary = parseSummaryResponse(rawSummary);
      if (summary) {
        workingState = { ...workingState, conversationSummary: summary };
        logInfo(`[Summary]`, `Generated for session ${sessionId} at turn ${workingState.turnCount}`);
      }
    } catch (err) {
      logWarn(`[Summary]`, `Failed for session ${sessionId}: ${(err as Error).message}`);
      // Non-fatal — continue without summary
    }
  }

  // --- Node 4: Build speaker prompt ---
  const speakerPrompt = buildSpeakerPrompt(workingState);

  // --- Node 5: Call Speaker LLM ---
  let reply = "";
  let speakerFailed = false;
  try {
    const speakerConfig = getSpeakerLLMConfig(state.voiceMode);
    const speakerResponse = await openai.chat.completions.create({
      ...speakerConfig,
      messages: [{ role: "user", content: speakerPrompt }],
    });
    reply = speakerResponse.choices[0]?.message?.content?.trim() ?? "";
    if (!reply) throw new Error("Empty speaker response");
  } catch (err) {
    logError(`[Speaker]`, `Failed on turn ${state.turnCount} (session ${sessionId})`, err);
    reply = getSpeakerFallbackReply(phase);
    speakerFailed = true;
  }

  // --- Append messages to history ---
  const now = new Date().toISOString();
  const userMessage = { role: "user" as const, content: state.currentUserInput, timestamp: now };
  const assistantMessage = { role: "assistant" as const, content: reply, timestamp: now };

  workingState = {
    ...workingState,
    messages: [...workingState.messages, userMessage, assistantMessage],
    currentAssistantReply: reply,
    // If speaker failed, roll back phaseTurnCount increment (free turn policy)
    phaseTurnCount: speakerFailed
      ? Math.max(0, workingState.phaseTurnCount - 1)
      : workingState.phaseTurnCount,
  };

  return workingState;
}

// =============================================================================
// Express app
// =============================================================================

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow all origins for development; tighten for production
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  next();
});

app.options("*", (_req, res) => res.sendStatus(204));

// =============================================================================
// POST /session — Create a new session
// =============================================================================

app.post("/session", (req: Request, res: Response) => {
  try {
    const voiceMode: VoiceMode =
      req.body?.voiceMode === "voice" ? "voice" : "chat";

    const sessionId = uuidv4();
    const state = initialState(sessionId, voiceMode);

    dbSaveSession(state);
    logInfo("[Session]", `Created ${sessionId} (${voiceMode})`);

    res.json({
      sessionId,
      currentPhase: state.currentPhase,
      voiceMode: state.voiceMode,
      createdAt: state.createdAt,
    });
  } catch (err) {
    logError("[Session]", "Failed to create session", err);
    res.status(500).json({ error: PIPELINE_ERROR.userMessage });
  }
});

// =============================================================================
// POST /chat — Process a message turn
// =============================================================================

app.post("/chat", async (req: Request, res: Response) => {
  const { sessionId, message } = req.body ?? {};

  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId is required." });
  }
  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "message is required and cannot be empty." });
  }

  // Load session
  let state = dbGetSession(sessionId);
  if (!state) {
    return res
      .status(SESSION_NOT_FOUND_RESPONSE.httpStatus)
      .json(SESSION_NOT_FOUND_RESPONSE.body);
  }

  // Reject messages to closed sessions
  if (state.currentPhase === "done") {
    return res.json({
      reply: "This session has ended. Please start a new session if you need further help.",
      currentPhase: "done",
      sessionId,
    });
  }

  // Inject user input into state
  state = { ...state, currentUserInput: message.trim() };

  // Run the pipeline
  let nextState: LegalAgentState;
  try {
    nextState = await runTurn(state);
  } catch (err) {
    logError("[Pipeline]", `runTurn failed for session ${sessionId}`, err);

    // Check for OpenAI rate limit
    if ((err as Error).message?.includes("429")) {
      return res.status(RATE_LIMIT_ERROR.httpStatus).json({
        error: RATE_LIMIT_ERROR.userMessage,
      });
    }

    return res.status(500).json({ error: PIPELINE_ERROR.userMessage });
  }

  // Persist
  try {
    dbSaveSession(nextState);
  } catch (err) {
    logError("[Database]", `Write failed for session ${sessionId}`, err);
    const dbErr = getDatabaseError("write", { sessionId, turnCount: nextState.turnCount });
    return res.status(dbErr.httpStatus).json({ error: dbErr.userMessage });
  }

  logInfo(
    "[Chat]",
    `Session ${sessionId} | Turn ${nextState.turnCount} | Phase: ${nextState.currentPhase}`
  );

  res.json({
    reply: nextState.currentAssistantReply,
    currentPhase: nextState.currentPhase,
    turnCount: nextState.turnCount,
    riskFlags: nextState.riskFlags,
    sessionId,
  });
});

// =============================================================================
// POST /upload/:sessionId — Upload photo or video evidence
// =============================================================================

app.post(
  "/upload/:sessionId",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    // Load session
    const state = dbGetSession(sessionId);
    if (!state) {
      // Clean up uploaded file if session not found
      if (req.file) fs.unlink(req.file.path, () => {});
      return res
        .status(SESSION_NOT_FOUND_RESPONSE.httpStatus)
        .json(SESSION_NOT_FOUND_RESPONSE.body);
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file was received. Please attach a file." });
    }

    const { originalname, mimetype, size, path: tempPath, filename } = req.file;

    // Validate MIME type and size
    const validationError = validateUploadedFile(originalname, mimetype, size);
    if (validationError) {
      logWarn("[Upload]", validationError.logMessage);
      fs.unlink(tempPath, () => {});
      return res.status(validationError.httpStatus).json({
        error: validationError.userMessage,
      });
    }

    // Move to final location with UUID filename
    const extension = path.extname(originalname).toLowerCase();
    const storedName = `${filename}${extension}`;
    const finalPath = path.join(UPLOADS_DIR, storedName);

    try {
      fs.renameSync(tempPath, finalPath);
    } catch (err) {
      logError("[Upload]", `Failed to move file ${originalname}`, err);
      const diskErr = getFileUploadError("disk", { fileName: originalname });
      return res.status(diskErr.httpStatus).json({ error: diskErr.userMessage });
    }

    // Analyse with OpenAI vision
    let description = getFileAnalysisFallbackDescription(originalname);
    try {
      const fileBuffer = fs.readFileSync(finalPath);
      const base64 = fileBuffer.toString("base64");
      const isVideo = mimetype.startsWith("video/");

      if (isVideo) {
        // For video files, describe based on metadata only (vision API accepts images, not video)
        description = `${originalname} — video file uploaded to case evidence file (${(size / 1024 / 1024).toFixed(1)} MB).`;
      } else {
        const visionResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimetype};base64,${base64}`,
                    detail: "low",
                  },
                },
                {
                  type: "text",
                  text: "You are a legal case assistant. Describe what you see in this image in 1–2 sentences, focusing on legally relevant details (damage, injuries, locations, documents, people, objects). Be factual and neutral. Do not speculate about legal conclusions.",
                },
              ],
            },
          ],
        });
        const raw = visionResponse.choices[0]?.message?.content?.trim() ?? "";
        if (raw) description = raw;
      }
    } catch (err) {
      logWarn(
        "[FileAnalysis]",
        `Vision API failed for ${originalname}: ${(err as Error).message} — using fallback description`
      );
      // description already set to fallback — continue
    }

    // Build file record
    const fileRecord = {
      id: uuidv4(),
      originalName: originalname,
      storedName,
      mimeType: mimetype,
      size,
      uploadedAt: new Date().toISOString(),
      description,
    };

    // Append to session state
    const updatedState: LegalAgentState = {
      ...state,
      uploadedFiles: [...state.uploadedFiles, fileRecord],
      updatedAt: new Date().toISOString(),
    };

    try {
      dbSaveSession(updatedState);
    } catch (err) {
      logError("[Database]", `Write failed after upload for session ${sessionId}`, err);
      const dbErr = getDatabaseError("write", { sessionId });
      return res.status(dbErr.httpStatus).json({ error: dbErr.userMessage });
    }

    logInfo(
      "[Upload]",
      `Session ${sessionId} | File: ${originalname} | ${(size / 1024 / 1024).toFixed(1)} MB`
    );

    res.json({
      fileId: fileRecord.id,
      originalName: fileRecord.originalName,
      description: fileRecord.description,
      uploadedAt: fileRecord.uploadedAt,
    });
  }
);

// =============================================================================
// GET /session/:sessionId — Retrieve full session state (Litmetrics payload)
// =============================================================================

app.get("/session/:sessionId", (req: Request, res: Response) => {
  const { sessionId } = req.params;

  const state = dbGetSession(sessionId);
  if (!state) {
    return res
      .status(SESSION_NOT_FOUND_RESPONSE.httpStatus)
      .json(SESSION_NOT_FOUND_RESPONSE.body);
  }

  // Return full state — do not truncate transcript for Litmetrics
  res.json({
    sessionId: state.sessionId,
    currentPhase: state.currentPhase,
    voiceMode: state.voiceMode,
    turnCount: state.turnCount,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,

    // Intake
    legalDomain: state.legalDomain,
    legalIssueType: state.legalIssueType,
    jurisdiction: state.jurisdiction,
    urgencyLevel: state.urgencyLevel,

    // Situation
    incidentSummary: state.incidentSummary,
    incidentDate: state.incidentDate,
    incidentLocation: state.incidentLocation,
    clientRole: state.clientRole,
    partiesInvolved: state.partiesInvolved,
    timeline: state.timeline,
    priorLegalAction: state.priorLegalAction,
    evidenceNoted: state.evidenceNoted,

    // Insurance
    insuranceCoverageType: state.insuranceCoverageType,
    insuranceProvider: state.insuranceProvider,
    insuranceClaimFiled: state.insuranceClaimFiled,
    estimatedDamages: state.estimatedDamages,
    financialExposure: state.financialExposure,
    canAffordAttorney: state.canAffordAttorney,

    // Witnesses
    witnesses: state.witnesses,
    evidenceItems: state.evidenceItems,
    policeReportFiled: state.policeReportFiled,
    policeReportNumber: state.policeReportNumber,
    hasDigitalEvidence: state.hasDigitalEvidence,

    // Guidance
    referralNeeded: state.referralNeeded,
    referralAccepted: state.referralAccepted,

    // Litmetrics
    liabilityScore: state.liabilityScore,
    caseStrengthScore: state.caseStrengthScore,
    settlementLikelihoodScore: state.settlementLikelihoodScore,
    statuteOfLimitationsFlag: state.statuteOfLimitationsFlag,
    extractedFacts: state.extractedFacts,
    riskFlags: state.riskFlags,

    // Files
    uploadedFiles: state.uploadedFiles.map((f) => ({
      id: f.id,
      originalName: f.originalName,
      mimeType: f.mimeType,
      size: f.size,
      uploadedAt: f.uploadedAt,
      description: f.description,
    })),

    // Full transcript — never truncated
    transcript: state.messages,
  });
});

// =============================================================================
// GET /sessions — List all sessions (Litmetrics dashboard)
// =============================================================================

app.get("/sessions", (_req: Request, res: Response) => {
  try {
    const sessions = dbListSessions();
    res.json(sessions);
  } catch (err) {
    logError("[Sessions]", "Failed to list sessions", err);
    res.status(500).json({ error: PIPELINE_ERROR.userMessage });
  }
});

// =============================================================================
// DELETE /session/:sessionId — Close and archive a session
// =============================================================================

app.delete("/session/:sessionId", (req: Request, res: Response) => {
  const { sessionId } = req.params;

  const state = dbGetSession(sessionId);
  if (!state) {
    return res
      .status(SESSION_NOT_FOUND_RESPONSE.httpStatus)
      .json(SESSION_NOT_FOUND_RESPONSE.body);
  }

  try {
    const closedState: LegalAgentState = {
      ...state,
      currentPhase: "done",
      sessionClosed: true,
      updatedAt: new Date().toISOString(),
    };
    dbSaveSession(closedState);
    logInfo("[Session]", `Closed ${sessionId}`);
    res.json({ sessionId, closed: true });
  } catch (err) {
    logError("[Session]", `Failed to close session ${sessionId}`, err);
    res.status(500).json({ error: PIPELINE_ERROR.userMessage });
  }
});

// =============================================================================
// POST /voice/transcribe — Audio → text (STT via Deepgram)
// Requires DEEPGRAM_API_KEY. Accepts audio/webm, audio/mp4, audio/mpeg.
// =============================================================================

app.post(
  "/voice/transcribe",
  upload.single("audio"),
  async (req: Request, res: Response) => {
    if (!DEEPGRAM_API_KEY) {
      return res.status(503).json({
        error: "Speech-to-text is not configured. Please set DEEPGRAM_API_KEY.",
      });
    }

    const { sessionId } = req.body ?? {};
    if (!sessionId || !dbGetSession(sessionId)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json(SESSION_NOT_FOUND_RESPONSE.body);
    }

    if (!req.file) {
      return res.status(400).json({ error: "No audio file received." });
    }

    try {
      const audioBuffer = fs.readFileSync(req.file.path);

      const dgRes = await fetch(
        "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=en-US",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${DEEPGRAM_API_KEY}`,
            "Content-Type": req.file.mimetype,
          },
          body: audioBuffer,
        }
      );

      fs.unlink(req.file.path, () => {});

      if (!dgRes.ok) {
        throw new Error(`Deepgram returned ${dgRes.status}`);
      }

      const dgData = (await dgRes.json()) as {
        results?: {
          channels?: Array<{
            alternatives?: Array<{ transcript?: string; confidence?: number }>;
          }>;
        };
      };

      const transcript =
        dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

      if (!transcript.trim()) {
        const err = getSTTError({ sessionId });
        logWarn("[STT]", err.logMessage);
        return res.json({ transcript: "", fallback: err.userMessage });
      }

      res.json({ transcript });
    } catch (err) {
      if (req.file) fs.unlink(req.file.path, () => {});
      const sttErr = getSTTError({ sessionId });
      logError("[STT]", sttErr.logMessage, err);
      res.status(500).json({ error: sttErr.userMessage });
    }
  }
);

// =============================================================================
// POST /voice/synthesise — Text → audio (TTS via ElevenLabs)
// Requires ELEVENLABS_API_KEY. Returns audio/mpeg stream.
// =============================================================================

app.post("/voice/synthesise", async (req: Request, res: Response) => {
  if (!ELEVENLABS_API_KEY) {
    return res.status(503).json({
      error: "Text-to-speech is not configured. Please set ELEVENLABS_API_KEY.",
    });
  }

  const { text, sessionId } = req.body ?? {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text is required." });
  }

  try {
    const elRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.2,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!elRes.ok) {
      throw new Error(`ElevenLabs returned ${elRes.status}`);
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");

    // Stream audio directly to client
    const reader = elRes.body;
    if (!reader) throw new Error("No response body from ElevenLabs");
    reader.pipe(res as unknown as NodeJS.WritableStream);
  } catch (err) {
    const ttsErr = getTTSError({ sessionId });
    logError("[TTS]", ttsErr.logMessage, err);
    // If headers not yet sent, return JSON fallback note
    if (!res.headersSent) {
      res.status(500).json({
        error: ttsErr.fallbackNote,
      });
    }
  }
});

// =============================================================================
// Health check
// =============================================================================

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    uptime: process.uptime(),
    voiceEnabled: !!(DEEPGRAM_API_KEY && ELEVENLABS_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// Global error handler
// =============================================================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logError("[Express]", "Unhandled error", err);
  if (!res.headersSent) {
    res.status(500).json({ error: PIPELINE_ERROR.userMessage });
  }
});

// =============================================================================
// Start server
// =============================================================================

app.listen(PORT, () => {
  logInfo("[Startup]", `LexAI pipeline server running on http://localhost:${PORT}`);
  logInfo("[Startup]", `Voice STT: ${DEEPGRAM_API_KEY ? "enabled (Deepgram)" : "disabled — set DEEPGRAM_API_KEY"}`);
  logInfo("[Startup]", `Voice TTS: ${ELEVENLABS_API_KEY ? "enabled (ElevenLabs)" : "disabled — set ELEVENLABS_API_KEY"}`);
  logInfo("[Startup]", `Uploads dir: ${UPLOADS_DIR}`);
  logInfo("[Startup]", `Database:    ${DB_PATH}`);
});

export default app;
