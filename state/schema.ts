// =============================================================================
// state/schema.ts
// LexAI Legal Intake Agent — State Schema
//
// Single source of truth for all session data.
// Persisted to SQLite as a JSON blob after every turn.
// All fields must have falsy defaults — never use undefined.
// =============================================================================

import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type Phase =
  | "intake"
  | "situation"
  | "insurance"
  | "witnesses"
  | "guidance"
  | "wrapup"
  | "done";

export type LegalDomain = "criminal" | "civil" | "";

export type LegalIssueType =
  // Criminal
  | "criminal-assault"
  | "criminal-dui"
  | "criminal-drug"
  | "criminal-theft"
  | "criminal-fraud"
  | "criminal-domestic-violence"
  | "criminal-homicide"
  | "criminal-sex-offense"
  | "criminal-white-collar"
  | "criminal-other"
  // Civil
  | "civil-personal-injury"
  | "civil-landlord-tenant"
  | "civil-employment"
  | "civil-contract"
  | "civil-family"
  | "civil-medical-malpractice"
  | "civil-property"
  | "civil-consumer"
  | "civil-civil-rights"
  | "civil-other"
  | "";

export type UrgencyLevel =
  | "emergency"   // Court date <48h | active arrest | restraining order violation | active threat to safety
  | "urgent"      // Court date <2 weeks | imminent financial harm | bail hearing pending
  | "standard"    // Active legal issue, no imminent deadline
  | "exploratory" // Hypothetical or general research question
  | "";

export type InsuranceCoverageType =
  | "auto"
  | "homeowners"
  | "renters"
  | "health"
  | "liability"
  | "workers-comp"
  | "none"
  | "unknown"
  | "";

export type WitnessType = "eyewitness" | "expert" | "character" | "other";

export type EvidenceType =
  | "photo"
  | "video"
  | "document"
  | "physical"
  | "digital"
  | "testimony"
  | "other";

export type VoiceMode = "voice" | "chat";

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------

export interface UploadedFile {
  id: string;            // UUID
  originalName: string;
  storedName: string;    // UUID filename on disk
  mimeType: string;      // image/* or video/*
  size: number;          // bytes
  uploadedAt: string;    // ISO 8601
  description: string;   // AI-generated visual summary
}

export interface Witness {
  name: string;          // or "unknown" / "unnamed witness"
  type: WitnessType;
  contactAvailable: boolean | null;
  notes: string;
}

export interface EvidenceItem {
  description: string;
  type: EvidenceType;
  inPossession: boolean | null;  // does the client have it?
  notes: string;
}

// ---------------------------------------------------------------------------
// Main state interface
// ---------------------------------------------------------------------------

export interface LegalAgentState {

  // -------------------------------------------------------------------------
  // Session metadata
  // -------------------------------------------------------------------------
  sessionId: string;
  currentPhase: Phase;
  turnCount: number;          // total turns since session start — never decreases
  phaseTurnCount: number;     // turns within current phase — resets on transition
  voiceMode: VoiceMode;       // "voice" | "chat" — set at session creation
  createdAt: string;          // ISO 8601
  updatedAt: string;          // ISO 8601

  // -------------------------------------------------------------------------
  // Conversation history
  // -------------------------------------------------------------------------
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: string;        // ISO 8601
  }>;
  conversationSummary: string; // populated by summarisation step (Skill 7) after turn 20

  // -------------------------------------------------------------------------
  // Phase 1 — Intake
  // Update policy: all overwrite (user may correct earlier answers)
  // -------------------------------------------------------------------------
  legalDomain: LegalDomain;       // "criminal" | "civil" | ""
  legalIssueType: LegalIssueType; // specific issue within domain
  jurisdiction: string;           // US state(s) or "federal" — free text, normalised
  urgencyLevel: UrgencyLevel;

  // -------------------------------------------------------------------------
  // Phase 2 — Situation
  // -------------------------------------------------------------------------
  incidentSummary: string;        // update policy: overwrite (refined each turn)
  incidentDate: string;           // update policy: overwrite — free text date/period
  incidentLocation: string;       // update policy: overwrite — city/state or description
  partiesInvolved: string[];      // update policy: append + dedupe
  clientRole: string;             // update policy: overwrite — e.g. "defendant", "plaintiff", "victim"
  timeline: string;               // update policy: overwrite — narrative sequence of events
  priorLegalAction: boolean | null; // update policy: overwrite — any prior filings/arrests
  priorLegalActionDetails: string;  // update policy: overwrite
  evidenceNoted: string[];        // update policy: append + dedupe — quick string notes

  // -------------------------------------------------------------------------
  // Phase 3 — Insurance / Financial
  // -------------------------------------------------------------------------
  insuranceCoverageType: InsuranceCoverageType; // update policy: overwrite
  insuranceProvider: string;      // update policy: overwrite
  insurancePolicyNumber: string;  // update policy: overwrite
  insuranceClaimFiled: boolean | null; // update policy: overwrite
  insuranceClaimNumber: string;   // update policy: overwrite
  estimatedDamages: string;       // update policy: overwrite — free text, no account numbers
  financialExposure: string;      // update policy: overwrite — e.g. "bail amount", "civil damages sought"
  canAffordAttorney: boolean | null; // update policy: overwrite — informs referral path

  // NOTE: Financial account numbers, SSNs, and dates of birth are NEVER collected.

  // -------------------------------------------------------------------------
  // Phase 4 — Witness & Evidence Inventory
  // -------------------------------------------------------------------------
  witnesses: Witness[];           // update policy: append
  evidenceItems: EvidenceItem[];  // update policy: append (structured, beyond evidenceNoted)
  policeReportFiled: boolean | null;  // update policy: overwrite
  policeReportNumber: string;     // update policy: overwrite
  hasDigitalEvidence: boolean | null; // update policy: overwrite — photos/video/texts/emails
  evidenceCustody: string;        // update policy: overwrite — who currently holds key evidence

  // -------------------------------------------------------------------------
  // Phase 5 — Guidance
  // -------------------------------------------------------------------------
  questionsAnswered: string[];    // update policy: append — log of topics covered
  generalInfoProvided: string[];  // update policy: append — summary of info given to client
  referralNeeded: boolean | null; // update policy: overwrite
  referralAccepted: boolean | null; // update policy: overwrite — did client agree to be connected?
  userSatisfied: boolean | null;  // update policy: overwrite

  // -------------------------------------------------------------------------
  // Phase 6 — Wrap-up
  // -------------------------------------------------------------------------
  disclaimerInjected: boolean;    // update policy: set-once
  nextStepsProvided: string[];    // update policy: append — action items given to client
  sessionClosed: boolean;         // update policy: set-once

  // -------------------------------------------------------------------------
  // Litmetrics output (computed once on entry to wrapup)
  // -------------------------------------------------------------------------
  liabilityScore: number | null;         // 0–100, set-once
  caseStrengthScore: number | null;      // 0–100, set-once
  settlementLikelihoodScore: number | null; // 0–100, set-once (civil cases only)
  statuteOfLimitationsFlag: string;      // set-once — "" | "ok" | "warning" | "critical"
  extractedFacts: string[];              // set-once — key facts for dashboard
  riskFlags: string[];                   // recomputed every turn from scratch

  // -------------------------------------------------------------------------
  // File tracking
  // -------------------------------------------------------------------------
  uploadedFiles: UploadedFile[];  // update policy: append — photos and video evidence only

  // -------------------------------------------------------------------------
  // Scratch fields (reset each turn — never persist meaningful state here)
  // -------------------------------------------------------------------------
  currentUserInput: string;
  currentAssistantReply: string;
  analyzerOutput: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// initialState factory
// Call once at session creation. Pass sessionId (UUID) and voiceMode.
// ---------------------------------------------------------------------------

export function initialState(
  sessionId: string,
  voiceMode: VoiceMode = "chat"
): LegalAgentState {
  const now = new Date().toISOString();
  return {
    // Session metadata
    sessionId,
    currentPhase: "intake",
    turnCount: 0,
    phaseTurnCount: 0,
    voiceMode,
    createdAt: now,
    updatedAt: now,

    // Conversation history
    messages: [],
    conversationSummary: "",

    // Phase 1 — Intake
    legalDomain: "",
    legalIssueType: "",
    jurisdiction: "",
    urgencyLevel: "",

    // Phase 2 — Situation
    incidentSummary: "",
    incidentDate: "",
    incidentLocation: "",
    partiesInvolved: [],
    clientRole: "",
    timeline: "",
    priorLegalAction: null,
    priorLegalActionDetails: "",
    evidenceNoted: [],

    // Phase 3 — Insurance / Financial
    insuranceCoverageType: "",
    insuranceProvider: "",
    insurancePolicyNumber: "",
    insuranceClaimFiled: null,
    insuranceClaimNumber: "",
    estimatedDamages: "",
    financialExposure: "",
    canAffordAttorney: null,

    // Phase 4 — Witness & Evidence Inventory
    witnesses: [],
    evidenceItems: [],
    policeReportFiled: null,
    policeReportNumber: "",
    hasDigitalEvidence: null,
    evidenceCustody: "",

    // Phase 5 — Guidance
    questionsAnswered: [],
    generalInfoProvided: [],
    referralNeeded: null,
    referralAccepted: null,
    userSatisfied: null,

    // Phase 6 — Wrap-up
    disclaimerInjected: false,
    nextStepsProvided: [],
    sessionClosed: false,

    // Litmetrics output
    liabilityScore: null,
    caseStrengthScore: null,
    settlementLikelihoodScore: null,
    statuteOfLimitationsFlag: "",
    extractedFacts: [],
    riskFlags: [],

    // File tracking
    uploadedFiles: [],

    // Scratch fields
    currentUserInput: "",
    currentAssistantReply: "",
    analyzerOutput: {},
  };
}

// ---------------------------------------------------------------------------
// Helper — create a new session with a generated UUID
// ---------------------------------------------------------------------------

export function createSession(voiceMode: VoiceMode = "chat"): LegalAgentState {
  return initialState(uuidv4(), voiceMode);
}

// ---------------------------------------------------------------------------
// Helper — deduplicate a string array (used by orchestrator merge logic)
// ---------------------------------------------------------------------------

export function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Helper — clamp a number to [min, max]
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Type guard — check if a value is a non-empty string
// ---------------------------------------------------------------------------

export function isSet(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}
