// =============================================================================
// src/test.ts
// LexAI Legal Intake Agent — Test Suite
//
// Five test layers (run in order):
//   Layer 1 — Schema validation          (no LLM, no DB)
//   Layer 2 — Orchestrator unit tests    (no LLM, no DB)
//   Layer 3 — Error recovery unit tests  (no LLM, no DB)
//   Layer 4 — End-to-end pipeline tests  (calls real LLM — needs OPENAI_API_KEY)
//   Layer 5 — API integration smoke test (needs running server on port 3000)
//
// Run all layers:     npx ts-node src/test.ts
// Run layers 1–3:     npx ts-node src/test.ts --unit
// Run layers 4–5:     npx ts-node src/test.ts --e2e
// =============================================================================

import { v4 as uuidv4 } from "uuid";
import {
  initialState,
  createSession,
  dedupe,
  clamp,
  isSet,
} from "../state/schema";
import type { LegalAgentState, Phase } from "../state/schema";
import { orchestrate, computeRiskFlags, extractFacts } from "./orchestrator";
import {
  phaseRegistry,
  ORDERED_PHASES,
  getProgressPercent,
  getPhaseLabel,
  EMERGENCY_BYPASS_PHASES,
  EMERGENCY_BYPASS_TARGET,
} from "../config/phase_registry";
import {
  getSpeakerFallbackReply,
  SPEAKER_FALLBACK_REPLIES,
  validateUploadedFile,
  getFileUploadError,
  isSessionStuck,
  STUCK_SESSION_TURN_THRESHOLD,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from "./error_recovery";
import {
  shouldSummarise,
  SUMMARY_TRIGGER_THRESHOLD,
  SUMMARY_REGEN_INTERVAL,
} from "./prompts/summary_prompt_creator";
import { buildAnalyzerPrompt } from "./prompts/analyzer_prompt_creator";
import { buildSpeakerPrompt } from "./prompts/speaker_prompt_creator";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const RUN_UNIT = args.includes("--unit") || !args.includes("--e2e");
const RUN_E2E  = args.includes("--e2e")  || !args.includes("--unit");

// ---------------------------------------------------------------------------
// Simple assert utility
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(60)}`);
}

// ---------------------------------------------------------------------------
// LAYER 1 — Schema validation
// ---------------------------------------------------------------------------

function layer1_schemaValidation(): void {
  section("Layer 1 — Schema Validation");

  const state = initialState("test-session-001");

  // Core metadata
  assert(state.sessionId === "test-session-001", "sessionId is set correctly");
  assert(state.currentPhase === "intake", "initial phase is intake");
  assert(state.turnCount === 0, "turnCount starts at 0");
  assert(state.phaseTurnCount === 0, "phaseTurnCount starts at 0");
  assert(state.voiceMode === "chat", "default voiceMode is chat");

  // All string fields start as ""
  assert(state.legalDomain === "", "legalDomain defaults to ''");
  assert(state.legalIssueType === "", "legalIssueType defaults to ''");
  assert(state.jurisdiction === "", "jurisdiction defaults to ''");
  assert(state.urgencyLevel === "", "urgencyLevel defaults to ''");
  assert(state.incidentSummary === "", "incidentSummary defaults to ''");
  assert(state.incidentDate === "", "incidentDate defaults to ''");
  assert(state.incidentLocation === "", "incidentLocation defaults to ''");
  assert(state.clientRole === "", "clientRole defaults to ''");
  assert(state.timeline === "", "timeline defaults to ''");
  assert(state.insuranceCoverageType === "", "insuranceCoverageType defaults to ''");
  assert(state.insuranceProvider === "", "insuranceProvider defaults to ''");
  assert(state.policeReportNumber === "", "policeReportNumber defaults to ''");
  assert(state.evidenceCustody === "", "evidenceCustody defaults to ''");

  // All nullable fields start as null
  assert(state.priorLegalAction === null, "priorLegalAction defaults to null");
  assert(state.insuranceClaimFiled === null, "insuranceClaimFiled defaults to null");
  assert(state.canAffordAttorney === null, "canAffordAttorney defaults to null");
  assert(state.policeReportFiled === null, "policeReportFiled defaults to null");
  assert(state.hasDigitalEvidence === null, "hasDigitalEvidence defaults to null");
  assert(state.referralNeeded === null, "referralNeeded defaults to null");
  assert(state.referralAccepted === null, "referralAccepted defaults to null");
  assert(state.userSatisfied === null, "userSatisfied defaults to null");
  assert(state.liabilityScore === null, "liabilityScore defaults to null");
  assert(state.caseStrengthScore === null, "caseStrengthScore defaults to null");
  assert(state.settlementLikelihoodScore === null, "settlementLikelihoodScore defaults to null");

  // All array fields start empty
  assert(state.messages.length === 0, "messages starts empty");
  assert(state.partiesInvolved.length === 0, "partiesInvolved starts empty");
  assert(state.evidenceNoted.length === 0, "evidenceNoted starts empty");
  assert(state.witnesses.length === 0, "witnesses starts empty");
  assert(state.evidenceItems.length === 0, "evidenceItems starts empty");
  assert(state.questionsAnswered.length === 0, "questionsAnswered starts empty");
  assert(state.generalInfoProvided.length === 0, "generalInfoProvided starts empty");
  assert(state.nextStepsProvided.length === 0, "nextStepsProvided starts empty");
  assert(state.uploadedFiles.length === 0, "uploadedFiles starts empty");
  assert(state.riskFlags.length === 0, "riskFlags starts empty");
  assert(state.extractedFacts.length === 0, "extractedFacts starts empty");

  // Boolean fields
  assert(state.disclaimerInjected === false, "disclaimerInjected starts false");
  assert(state.sessionClosed === false, "sessionClosed starts false");

  // Litmetrics flag
  assert(state.statuteOfLimitationsFlag === "", "statuteOfLimitationsFlag defaults to ''");

  // Helper functions
  assert(dedupe(["a", "b", "a", "c"]).length === 3, "dedupe removes duplicates");
  assert(dedupe(["  a  ", "a"]).length === 1, "dedupe trims whitespace");
  assert(clamp(150, 0, 100) === 100, "clamp caps at max");
  assert(clamp(-10, 0, 100) === 0, "clamp floors at min");
  assert(clamp(50, 0, 100) === 50, "clamp passes through in-range values");
  assert(isSet("hello") === true, "isSet returns true for non-empty string");
  assert(isSet("") === false, "isSet returns false for empty string");
  assert(isSet("  ") === false, "isSet returns false for whitespace string");

  // Voice mode variant
  const voiceSession = initialState("vs-001", "voice");
  assert(voiceSession.voiceMode === "voice", "voice session sets voiceMode correctly");

  // createSession generates a UUID
  const s = createSession();
  assert(s.sessionId.length === 36, "createSession generates a UUID sessionId");

  console.log("\n  → Layer 1 complete");
}

// ---------------------------------------------------------------------------
// LAYER 2 — Orchestrator unit tests
// ---------------------------------------------------------------------------

function layer2_orchestratorTests(): void {
  section("Layer 2 — Orchestrator Unit Tests");

  // --- 2.1 Intake → Situation transition ---
  {
    const state = initialState("t1");
    const updates = orchestrate(state, {
      legalDomain: "civil",
      legalIssueType: "civil-personal-injury",
      jurisdiction: "California",
      urgencyLevel: "standard",
    });
    const next = { ...state, ...updates };
    assert(next.currentPhase === "situation", "2.1: Intake→Situation on complete intake");
    assert(next.legalIssueType === "civil-personal-injury", "2.1: legalIssueType merged");
    assert(next.jurisdiction === "California", "2.1: jurisdiction merged");
    assert(next.phaseTurnCount === 0, "2.1: phaseTurnCount resets on transition");
    assert(next.turnCount === 1, "2.1: turnCount increments");
  }

  // --- 2.2 Partial intake — should NOT transition ---
  {
    const state = initialState("t2");
    const updates = orchestrate(state, {
      legalDomain: "criminal",
      legalIssueType: "criminal-dui",
    });
    const next = { ...state, ...updates };
    assert(next.currentPhase === "intake", "2.2: Incomplete intake stays in intake");
    assert(next.phaseTurnCount === 1, "2.2: phaseTurnCount increments without transition");
  }

  // --- 2.3 maxTurns forces intake→situation ---
  {
    const state = { ...initialState("t3"), phaseTurnCount: 5 }; // maxTurns=6, so next turn is 6
    const updates = orchestrate(state, {}); // empty output — still forces transition
    const next = { ...state, ...updates };
    assert(next.currentPhase === "situation", "2.3: maxTurns forces intake→situation");
    assert(next.phaseTurnCount === 0, "2.3: phaseTurnCount resets after forced transition");
  }

  // --- 2.4 Emergency bypass — intake → guidance ---
  {
    const state = initialState("t4");
    const updates = orchestrate(state, {
      legalDomain: "criminal",
      legalIssueType: "criminal-assault",
      jurisdiction: "Texas",
      urgencyLevel: "emergency",
    });
    const next = { ...state, ...updates };
    assert(next.currentPhase === EMERGENCY_BYPASS_TARGET, "2.4: Emergency bypasses to guidance");
    assert(next.phaseTurnCount === 0, "2.4: phaseTurnCount resets on emergency bypass");
  }

  // --- 2.5 Emergency bypass — situation → guidance ---
  {
    const state = {
      ...initialState("t5"),
      currentPhase: "situation" as Phase,
      legalDomain: "criminal" as const,
      urgencyLevel: "emergency" as const,
    };
    const updates = orchestrate(state, {});
    const next = { ...state, ...updates };
    assert(next.currentPhase === "guidance", "2.5: Emergency bypass from situation→guidance");
  }

  // --- 2.6 Risk flags — emergency ---
  {
    const state = { ...initialState("t6"), urgencyLevel: "emergency" as const };
    const updates = orchestrate(state, {});
    const next = { ...state, ...updates };
    assert(
      next.riskFlags.some((f) => f.includes("URGENT")),
      "2.6: Emergency risk flag present"
    );
  }

  // --- 2.7 Risk flags — high severity criminal ---
  {
    const state = {
      ...initialState("t7"),
      currentPhase: "situation" as Phase,
      legalDomain: "criminal" as const,
      legalIssueType: "criminal-homicide" as const,
      jurisdiction: "Texas",
      urgencyLevel: "urgent" as const,
    };
    const flags = computeRiskFlags(state);
    assert(
      flags.some((f) => f.includes("High-severity")),
      "2.7: High-severity criminal flag for homicide"
    );
  }

  // --- 2.8 Risk flags — no jurisdiction past intake ---
  {
    const state = {
      ...initialState("t8"),
      currentPhase: "situation" as Phase,
      jurisdiction: "",
    };
    const flags = computeRiskFlags(state);
    assert(
      flags.some((f) => f.includes("Jurisdiction not confirmed")),
      "2.8: Missing jurisdiction flag after intake"
    );
  }

  // --- 2.9 SSN guard in insurance phase ---
  {
    const state = {
      ...initialState("t9"),
      currentPhase: "insurance" as Phase,
      legalDomain: "civil" as const,
    };
    const updates = orchestrate(state, {
      insuranceCoverageType: "health",
      insurancePolicyNumber: "123-45-6789", // SSN pattern — must be rejected
      canAffordAttorney: true,
    });
    const next = { ...state, ...updates };
    assert(next.insurancePolicyNumber === "", "2.9: SSN-shaped policy number rejected");
    assert(next.insuranceCoverageType === "health", "2.9: Valid insurance type merged");
  }

  // --- 2.10 Situation → Insurance transition ---
  {
    const state = {
      ...initialState("t10"),
      currentPhase: "situation" as Phase,
      legalDomain: "civil" as const,
    };
    const updates = orchestrate(state, {
      incidentSummary: "Client slipped and fell in a grocery store",
      incidentDate: "March 1 2025",
      incidentLocation: "Whole Foods, Austin TX",
      partiesInvolved: ["Whole Foods Market"],
      clientRole: "plaintiff",
      timeline: "March 1: slipped on wet floor; taken to ER; no wet floor sign present",
    });
    const next = { ...state, ...updates };
    assert(next.currentPhase === "insurance", "2.10: Situation→Insurance on complete situation");
    assert(next.partiesInvolved.includes("Whole Foods Market"), "2.10: Party appended");
    assert(next.clientRole === "plaintiff", "2.10: clientRole merged");
  }

  // --- 2.11 Insurance → Witnesses transition ---
  {
    const state = {
      ...initialState("t11"),
      currentPhase: "insurance" as Phase,
      legalDomain: "civil" as const,
    };
    const updates = orchestrate(state, {
      insuranceCoverageType: "health",
      canAffordAttorney: false,
    });
    const next = { ...state, ...updates };
    assert(next.currentPhase === "witnesses", "2.11: Insurance→Witnesses on complete insurance");
    assert(next.canAffordAttorney === false, "2.11: canAffordAttorney false merged correctly");
  }

  // --- 2.12 Witnesses → Guidance transition ---
  {
    const state = {
      ...initialState("t12"),
      currentPhase: "witnesses" as Phase,
      legalDomain: "civil" as const,
    };
    const updates = orchestrate(state, {
      policeReportFiled: true,
      policeReportNumber: "2025-ATX-00123",
      witnesses: [{ name: "Jane Doe", type: "eyewitness", contactAvailable: true, notes: "store employee" }],
      evidenceItems: [{ description: "Security camera footage", type: "video", inPossession: false, notes: "held by store" }],
    });
    const next = { ...state, ...updates };
    assert(next.currentPhase === "guidance", "2.12: Witnesses→Guidance on complete inventory");
    assert(next.witnesses.length === 1, "2.12: Witness appended correctly");
    assert(next.evidenceItems.length === 1, "2.12: Evidence item appended correctly");
    assert(next.policeReportNumber === "2025-ATX-00123", "2.12: Police report number merged");
  }

  // --- 2.13 Litmetrics set-once policy ---
  {
    const state = {
      ...initialState("t13"),
      currentPhase: "guidance" as Phase,
      legalDomain: "civil" as const,
      liabilityScore: 72,       // already set
      caseStrengthScore: 65,
      settlementLikelihoodScore: 55,
    };
    const updates = orchestrate(state, {
      userSatisfied: true,
    });
    const next = { ...state, ...updates };
    // Should transition to wrapup but NOT recompute scores (set-once)
    assert(next.currentPhase === "wrapup", "2.13: Guidance→Wrapup on userSatisfied");
    assert(next.liabilityScore === 72, "2.13: Litmetrics scores not overwritten (set-once)");
  }

  // --- 2.14 Wrapup → Done transition ---
  {
    const state = {
      ...initialState("t14"),
      currentPhase: "wrapup" as Phase,
      liabilityScore: 60,
      caseStrengthScore: 55,
      settlementLikelihoodScore: 40,
      statuteOfLimitationsFlag: "ok",
      extractedFacts: ["Legal issue: civil-personal-injury"],
    };
    const updates = orchestrate(state, {
      userAcknowledgedDisclaimer: true,
    });
    const next = { ...state, ...updates };
    assert(next.currentPhase === "done", "2.14: Wrapup→Done on disclaimer acknowledged");
    assert(next.disclaimerInjected === true, "2.14: disclaimerInjected set to true");
  }

  // --- 2.15 Deduplicated party append ---
  {
    const state = {
      ...initialState("t15"),
      currentPhase: "situation" as Phase,
      partiesInvolved: ["employer XYZ Corp"],
    };
    const updates = orchestrate(state, {
      incidentSummary: "Wrongful termination",
      timeline: "Fired March 1",
      clientRole: "plaintiff",
      partiesInvolved: ["employer XYZ Corp", "HR manager John Smith"], // duplicate + new
    });
    const next = { ...state, ...updates };
    assert(next.partiesInvolved.length === 2, "2.15: Duplicate party deduplicated on append");
    assert(next.partiesInvolved.includes("HR manager John Smith"), "2.15: New party appended");
  }

  // --- 2.16 Phase registry coverage ---
  {
    assert(ORDERED_PHASES.length === 6, "2.16: Phase registry has 6 ordered phases");
    assert(getProgressPercent("intake") === 0, "2.16: Intake progress is 0%");
    assert(getProgressPercent("done") === 100, "2.16: Done progress is 100%");
    assert(getPhaseLabel("wrapup") === "Wrapping up", "2.16: Wrapup label correct");
    assert(EMERGENCY_BYPASS_PHASES.has("intake"), "2.16: Intake is bypassable");
    assert(EMERGENCY_BYPASS_PHASES.has("insurance"), "2.16: Insurance is bypassable");
    assert(!EMERGENCY_BYPASS_PHASES.has("guidance"), "2.16: Guidance is not bypassable");
  }

  // --- 2.17 extractFacts coverage ---
  {
    const state: LegalAgentState = {
      ...initialState("t17"),
      legalDomain: "criminal",
      legalIssueType: "criminal-dui",
      jurisdiction: "Texas",
      urgencyLevel: "emergency",
      clientRole: "defendant",
      incidentSummary: "DUI arrest outside bar",
      incidentDate: "March 3 2025",
      incidentLocation: "6th Street, Austin",
      timeline: "Pulled over, failed breathalyser, arrested",
      partiesInvolved: ["arresting officer"],
      policeReportFiled: true,
      policeReportNumber: "APD-2025-1234",
      canAffordAttorney: false,
      referralNeeded: true,
      referralAccepted: true,
    };
    const facts = extractFacts(state);
    assert(facts.some((f) => f.includes("criminal-dui")), "2.17: extractFacts includes issue type");
    assert(facts.some((f) => f.includes("Texas")), "2.17: extractFacts includes jurisdiction");
    assert(facts.some((f) => f.includes("defendant")), "2.17: extractFacts includes client role");
    assert(facts.some((f) => f.includes("APD-2025-1234")), "2.17: extractFacts includes report number");
    assert(facts.some((f) => f.includes("referral accepted: yes")), "2.17: extractFacts includes referral status");
  }

  console.log("\n  → Layer 2 complete");
}

// ---------------------------------------------------------------------------
// LAYER 3 — Error recovery unit tests
// ---------------------------------------------------------------------------

function layer3_errorRecoveryTests(): void {
  section("Layer 3 — Error Recovery Unit Tests");

  // --- 3.1 Speaker fallback replies — all phases covered ---
  {
    const phases: Phase[] = ["intake", "situation", "insurance", "witnesses", "guidance", "wrapup", "done"];
    for (const phase of phases) {
      const reply = getSpeakerFallbackReply(phase);
      assert(reply.length > 0, `3.1: Fallback reply exists for phase: ${phase}`);
    }
  }

  // --- 3.2 Fallback replies don't contain technical jargon ---
  {
    const technicalTerms = ["undefined", "null", "error", "stack", "exception", "500", "API"];
    for (const [phase, reply] of Object.entries(SPEAKER_FALLBACK_REPLIES)) {
      for (const term of technicalTerms) {
        assert(
          !reply.toLowerCase().includes(term.toLowerCase()),
          `3.2: Fallback for ${phase} doesn't contain technical term "${term}"`
        );
      }
    }
  }

  // --- 3.3 File validation — valid image ---
  {
    const error = validateUploadedFile("photo.jpg", "image/jpeg", 1024 * 1024); // 1 MB
    assert(error === null, "3.3: Valid JPEG passes file validation");
  }

  // --- 3.4 File validation — valid video ---
  {
    const error = validateUploadedFile("evidence.mp4", "video/mp4", 10 * 1024 * 1024); // 10 MB
    assert(error === null, "3.4: Valid MP4 passes file validation");
  }

  // --- 3.5 File validation — rejected MIME type ---
  {
    const error = validateUploadedFile("contract.pdf", "application/pdf", 500 * 1024);
    assert(error !== null, "3.5: PDF rejected (only photos and video accepted)");
    assert(error!.httpStatus === 415, "3.5: Rejected MIME returns 415");
    assert(!error!.userMessage.includes("undefined"), "3.5: User message is clean");
  }

  // --- 3.6 File validation — oversized file ---
  {
    const error = validateUploadedFile("huge.mp4", "video/mp4", 100 * 1024 * 1024); // 100 MB
    assert(error !== null, "3.6: Oversized file rejected");
    assert(error!.httpStatus === 413, "3.6: Oversized file returns 413");
  }

  // --- 3.7 MIME type allowlist completeness ---
  {
    const requiredTypes = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];
    for (const mime of requiredTypes) {
      assert(ALLOWED_MIME_TYPES.has(mime), `3.7: MIME type ${mime} is in allowlist`);
    }
    assert(MAX_FILE_SIZE_BYTES === 50 * 1024 * 1024, "3.7: Max file size is 50 MB");
  }

  // --- 3.8 Stuck session detection ---
  {
    const notStuck = { ...initialState("s1"), turnCount: 10, currentPhase: "intake" as Phase };
    assert(!isSessionStuck(notStuck), "3.8: Session with 10 turns is not stuck");

    const stuck = { ...initialState("s2"), turnCount: 31, currentPhase: "intake" as Phase };
    assert(isSessionStuck(stuck), "3.8: Session with 31 intake turns is stuck");

    const notStuckWrongPhase = { ...initialState("s3"), turnCount: 40, currentPhase: "guidance" as Phase };
    assert(!isSessionStuck(notStuckWrongPhase), "3.8: High turn count in guidance is not stuck");

    assert(STUCK_SESSION_TURN_THRESHOLD === 30, "3.8: Stuck session threshold is 30");
  }

  // --- 3.9 Summarisation thresholds ---
  {
    const shortSession = { ...initialState("sum1"), messages: Array(10).fill({ role: "user", content: "x", timestamp: "" }) };
    assert(!shouldSummarise(shortSession as LegalAgentState), "3.9: 10 messages does not trigger summary");

    const longSession = { ...initialState("sum2"), messages: Array(20).fill({ role: "user", content: "x", timestamp: "" }) };
    assert(shouldSummarise(longSession as LegalAgentState), "3.9: 20 messages triggers first summary");

    const summarisedSession = {
      ...initialState("sum3"),
      conversationSummary: "Existing summary",
      messages: Array(25).fill({ role: "user", content: "x", timestamp: "" }),
    };
    assert(!shouldSummarise(summarisedSession as LegalAgentState), "3.9: 25 messages with existing summary does not re-trigger");

    const regenSession = {
      ...initialState("sum4"),
      conversationSummary: "Existing summary",
      messages: Array(30).fill({ role: "user", content: "x", timestamp: "" }),
    };
    assert(shouldSummarise(regenSession as LegalAgentState), "3.9: 30 messages triggers regeneration");

    assert(SUMMARY_TRIGGER_THRESHOLD === 20, "3.9: Summary trigger threshold is 20");
    assert(SUMMARY_REGEN_INTERVAL === 10, "3.9: Summary regen interval is 10");
  }

  // --- 3.10 Prompt builders produce non-empty output ---
  {
    const state = {
      ...initialState("pb1"),
      currentUserInput: "I was in a car accident last week in Florida.",
    };
    const analyzerPrompt = buildAnalyzerPrompt(state);
    assert(analyzerPrompt.length > 100, "3.10: Analyzer prompt is non-trivially long");
    assert(analyzerPrompt.includes("PHASE: INTAKE"), "3.10: Analyzer prompt includes phase label");
    assert(analyzerPrompt.includes("I was in a car accident"), "3.10: Analyzer prompt includes user input");

    const speakerPrompt = buildSpeakerPrompt(state);
    assert(speakerPrompt.length > 100, "3.10: Speaker prompt is non-trivially long");
    assert(speakerPrompt.includes("I was in a car accident"), "3.10: Speaker prompt includes user input");
    assert(speakerPrompt.includes("RESPONSE INSTRUCTIONS"), "3.10: Speaker prompt includes output rules");
  }

  console.log("\n  → Layer 3 complete");
}

// ---------------------------------------------------------------------------
// LAYER 4 — End-to-end pipeline tests (requires real LLM)
// ---------------------------------------------------------------------------

// Minimal pipeline runner stub — replace with your actual runAgentTurn import
// once the pipeline server is implemented.
async function runAgentTurn(
  state: LegalAgentState
): Promise<LegalAgentState> {
  // Import dynamically to avoid breaking unit tests when pipeline isn't built
  try {
    const { runTurn } = await import("./pipeline");
    return runTurn(state);
  } catch {
    throw new Error(
      "Pipeline not found. Implement src/pipeline.ts before running Layer 4.\n" +
      "Run 'npx ts-node src/test.ts --unit' to skip e2e tests."
    );
  }
}

async function layer4_e2eTests(): Promise<void> {
  section("Layer 4 — End-to-End Pipeline Tests (LLM required)");

  // --- Criminal scenario: DUI with emergency urgency ---
  console.log("\n  Scenario A: Criminal DUI — Emergency\n");
  {
    const conversation = [
      "Hi, I need help urgently. I was arrested last night for DUI in Austin Texas and my arraignment is tomorrow morning.",
      "I failed a breathalyser. The officer said I was over the limit. I've never been arrested before.",
      "Yes there was a dashcam on a nearby car that might have caught it. I don't have a lawyer.",
      "No I can't really afford one. Is there a public defender I can get?",
      "What happens at the arraignment tomorrow?",
      "OK I think I understand. Do I need to say anything?",
      "Thank you, that helps. I'll stay quiet and wait for the public defender.",
      "Yes I understand this is general information only, not legal advice.",
    ];

    let state = createSession("voice"); // test voice mode path
    let phasesVisited = new Set<string>();

    for (const message of conversation) {
      state = await runAgentTurn({ ...state, currentUserInput: message });
      phasesVisited.add(state.currentPhase);
      console.log(`    Turn ${state.turnCount} | Phase: ${state.currentPhase} | Flags: ${state.riskFlags.length}`);
      if (state.currentPhase === "done") break;
    }

    assert(state.legalDomain === "criminal", "A: legalDomain is criminal");
    assert(state.legalIssueType === "criminal-dui", "A: legalIssueType is criminal-dui");
    assert(state.jurisdiction === "Texas" || state.jurisdiction === "Austin", "A: jurisdiction extracted");
    assert(state.urgencyLevel === "emergency", "A: urgencyLevel is emergency");
    assert(state.canAffordAttorney === false, "A: canAffordAttorney is false");
    assert(state.liabilityScore !== null, "A: liabilityScore computed at wrapup");
    assert(state.caseStrengthScore !== null, "A: caseStrengthScore computed");
    assert(state.extractedFacts.length > 0, "A: extractedFacts populated");
    assert(state.disclaimerInjected === true, "A: disclaimer injected");
    assert(phasesVisited.has("guidance"), "A: guidance phase visited");
    assert(phasesVisited.has("wrapup"), "A: wrapup phase visited");
    assert(state.riskFlags.some(f => f.includes("URGENT") || f.includes("public defender") || f.includes("cannot afford")),
      "A: Appropriate risk flag present");
  }

  // --- Civil scenario: Personal injury with full 6-phase flow ---
  console.log("\n  Scenario B: Civil Personal Injury — Full 6-Phase Flow\n");
  {
    const conversation = [
      "Hello, I was injured in a slip and fall at a grocery store in Miami Florida about two months ago.",
      "I slipped on a wet floor that had no warning signs. I broke my wrist. The store is Publix.",
      "It happened on January 15th 2025. I was taken to the ER that day.",
      "I have health insurance through my employer. I haven't filed an insurance claim yet. The medical bills are around $8,000.",
      "Yes I can afford an attorney. What are my options?",
      "There were two other shoppers nearby who saw it happen. I also have photos of my injury and the area where I fell.",
      "No police report was filed. The store manager took an incident report though.",
      "What kind of lawyer do I need and how long do I have to file?",
      "That's very helpful. Yes please connect me with a personal injury attorney in Florida.",
      "Yes I understand this is general information only. Thank you so much.",
    ];

    let state = createSession();
    let phasesVisited = new Set<string>();

    for (const message of conversation) {
      state = await runAgentTurn({ ...state, currentUserInput: message });
      phasesVisited.add(state.currentPhase);
      console.log(`    Turn ${state.turnCount} | Phase: ${state.currentPhase}`);
      if (state.currentPhase === "done") break;
    }

    assert(state.legalDomain === "civil", "B: legalDomain is civil");
    assert(state.legalIssueType === "civil-personal-injury", "B: legalIssueType is civil-personal-injury");
    assert(state.jurisdiction.toLowerCase().includes("florida") || state.jurisdiction === "FL", "B: jurisdiction is Florida");
    assert(state.partiesInvolved.length > 0, "B: parties involved extracted");
    assert(state.canAffordAttorney === true, "B: canAffordAttorney is true");
    assert(state.referralAccepted === true, "B: referral accepted");
    assert(state.settlementLikelihoodScore !== null, "B: settlementLikelihoodScore computed (civil)");
    assert(state.liabilityScore !== null, "B: liabilityScore computed");
    assert(state.caseStrengthScore !== null, "B: caseStrengthScore computed");
    assert(state.extractedFacts.length >= 5, "B: At least 5 extracted facts");
    assert(state.disclaimerInjected === true, "B: disclaimer injected");
    assert(phasesVisited.has("insurance"), "B: insurance phase visited");
    assert(phasesVisited.has("witnesses"), "B: witnesses phase visited");
    assert(phasesVisited.has("guidance"), "B: guidance phase visited");
    assert(phasesVisited.has("wrapup"), "B: wrapup phase visited");

    console.log(`\n    Litmetrics results:`);
    console.log(`    Liability:          ${state.liabilityScore}/100`);
    console.log(`    Case strength:      ${state.caseStrengthScore}/100`);
    console.log(`    Settlement likelihood: ${state.settlementLikelihoodScore}/100`);
    console.log(`    SoL flag:           ${state.statuteOfLimitationsFlag}`);
    console.log(`    Extracted facts:    ${state.extractedFacts.length}`);
    console.log(`    Risk flags:         ${state.riskFlags.length}`);
  }

  // --- Phase coverage validation ---
  console.log("\n  Phase Coverage Check\n");
  {
    // The phase registry must cover all phases in ORDERED_PHASES
    for (const phase of ORDERED_PHASES) {
      assert(
        phaseRegistry[phase] !== undefined,
        `Phase coverage: ${phase} has a registry entry`
      );
      assert(
        phaseRegistry[phase].maxTurns > 0,
        `Phase coverage: ${phase} has positive maxTurns`
      );
    }
  }

  console.log("\n  → Layer 4 complete");
}

// ---------------------------------------------------------------------------
// LAYER 5 — API integration smoke test
// ---------------------------------------------------------------------------

async function layer5_apiSmokeTest(): Promise<void> {
  section("Layer 5 — API Integration Smoke Test");

  const BASE_URL = "http://localhost:3000";

  async function apiCall(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; data: unknown }> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }

  // 5.1 Create session
  const createResult = await apiCall("POST", "/session");
  assert(createResult.status === 200 || createResult.status === 201, "5.1: POST /session returns 200/201");
  const sessionId = (createResult.data as { sessionId?: string }).sessionId;
  assert(typeof sessionId === "string" && sessionId.length === 36, "5.1: sessionId is a valid UUID");

  // 5.2 Send a message
  const chatResult = await apiCall("POST", "/chat", {
    sessionId,
    message: "Hi, I need help. I was wrongfully terminated from my job in New York.",
  });
  assert(chatResult.status === 200, "5.2: POST /chat returns 200");
  const reply = (chatResult.data as { reply?: string }).reply;
  assert(typeof reply === "string" && reply.length > 0, "5.2: Reply is non-empty string");
  assert(typeof reply === "string" && !reply.includes("undefined") && !reply.includes("null"), "5.2: Reply contains no raw nulls");

  // 5.3 Get session state
  const getResult = await apiCall("GET", `/session/${sessionId}`);
  assert(getResult.status === 200, "5.3: GET /session/:id returns 200");
  const sessionData = getResult.data as Record<string, unknown>;
  assert(sessionData.currentPhase === "intake", "5.3: Phase is intake after first message");
  assert(typeof sessionData.turnCount === "number", "5.3: turnCount is a number");
  assert(Array.isArray(sessionData.riskFlags), "5.3: riskFlags is an array");

  // 5.4 Session not found
  const notFoundResult = await apiCall("GET", "/session/00000000-0000-0000-0000-000000000000");
  assert(notFoundResult.status === 404, "5.4: Unknown sessionId returns 404");

  // 5.5 Invalid file upload (PDF should be rejected)
  const formData = new FormData();
  const fakeFile = new Blob(["fake pdf content"], { type: "application/pdf" });
  formData.append("file", fakeFile, "contract.pdf");
  const uploadResponse = await fetch(`${BASE_URL}/upload/${sessionId}`, {
    method: "POST",
    body: formData,
  });
  assert(uploadResponse.status === 415, "5.5: PDF upload returns 415 (unsupported type)");

  // 5.6 GET /sessions returns a list
  const listResult = await apiCall("GET", "/sessions");
  assert(listResult.status === 200, "5.6: GET /sessions returns 200");
  const sessions = listResult.data as unknown[];
  assert(Array.isArray(sessions), "5.6: /sessions returns an array");
  assert(
    sessions.some((s: unknown) => (s as { sessionId?: string }).sessionId === sessionId),
    "5.6: Test session appears in sessions list"
  );

  // 5.7 Voice session creation
  const voiceResult = await apiCall("POST", "/session", { voiceMode: "voice" });
  assert(voiceResult.status === 200 || voiceResult.status === 201, "5.7: Voice session created");
  const voiceSessionId = (voiceResult.data as { sessionId?: string }).sessionId;
  assert(typeof voiceSessionId === "string", "5.7: Voice session has a sessionId");

  console.log("\n  → Layer 5 complete");
}

// ---------------------------------------------------------------------------
// Pre-launch checklist summary
// ---------------------------------------------------------------------------

function printPreLaunchChecklist(): void {
  section("Pre-Launch Checklist");

  const checklist = [
    "Schema validation passes (Layer 1)",
    "Orchestrator unit tests pass — all 17 tests (Layer 2)",
    "Error recovery tests pass — all 10 groups (Layer 3)",
    "End-to-end tests complete without LLM errors (Layer 4)",
    "All 6 phases visited during e2e tests (Layer 4)",
    "Litmetrics scores computed at wrapup entry (Layer 4)",
    "Criminal scenario: emergency bypass fires correctly (Layer 4)",
    "Civil scenario: settlement score computed (Layer 4)",
    "API smoke test passes — all 7 endpoint checks (Layer 5)",
    "File upload rejects PDFs and oversized files (Layer 5)",
    "OPENAI_API_KEY is set in .env",
    "uploads/ directory exists and is writable",
    "data/ directory exists and is writable (SQLite)",
    "Deepgram API key set for STT (voice mode)",
    "ElevenLabs API key set for TTS (voice mode)",
    "Disclaimer language reviewed by legal counsel",
    "Risk flags reviewed with a practicing attorney",
    "No SSN/DOB/account-number fields in schema — confirmed",
  ];

  checklist.forEach((item) => console.log(`  [ ] ${item}`));
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║         LexAI Legal Intake Agent — Test Suite           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const startTime = Date.now();

  if (RUN_UNIT) {
    layer1_schemaValidation();
    layer2_orchestratorTests();
    layer3_errorRecoveryTests();
  }

  if (RUN_E2E) {
    try {
      await layer4_e2eTests();
    } catch (err) {
      console.error("\n  ✗ Layer 4 skipped or failed:", (err as Error).message);
    }

    try {
      await layer5_apiSmokeTest();
    } catch (err) {
      console.error("\n  ✗ Layer 5 skipped or failed:", (err as Error).message);
      console.error("  Make sure the server is running on port 3000 before running Layer 5.");
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed  (${elapsed}s)`);
  console.log(`${"═".repeat(60)}`);

  printPreLaunchChecklist();

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected test runner error:", err);
  process.exit(1);
});
