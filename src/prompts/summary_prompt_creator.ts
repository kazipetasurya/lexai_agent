// =============================================================================
// src/prompts/summary_prompt_creator.ts
// LexAI Legal Intake Agent — Conversation Summariser
//
// Manages conversation history summarisation for sessions exceeding 20 turns.
// Keeps the Speaker LLM's context window lean without losing case continuity.
//
// Summarisation thresholds (Skill 7):
//   < 20 messages  → no summary needed
//   20–40 messages → generate summary, use summary + last 8 for speaker
//   > 40 messages  → regenerate every 10 turns
// =============================================================================

import type { LegalAgentState } from "../../state/schema";

// ---------------------------------------------------------------------------
// Threshold constants
// ---------------------------------------------------------------------------
export const SUMMARY_TRIGGER_THRESHOLD = 20;   // messages before first summary
export const SUMMARY_REGEN_INTERVAL    = 10;   // turns between regenerations
export const SUMMARY_MAX_TOKENS        = 400;  // generous cap for long cases

// ---------------------------------------------------------------------------
// shouldSummarise
// Returns true when the orchestrator/pipeline runner should trigger a
// summarisation call before building the speaker prompt.
// ---------------------------------------------------------------------------

export function shouldSummarise(state: LegalAgentState): boolean {
  const messageCount = state.messages.length;

  if (messageCount < SUMMARY_TRIGGER_THRESHOLD) return false;

  // No summary yet — generate one now
  if (!state.conversationSummary) return true;

  // Regenerate every SUMMARY_REGEN_INTERVAL turns after the first summary
  const turnsSinceThreshold = messageCount - SUMMARY_TRIGGER_THRESHOLD;
  return turnsSinceThreshold % SUMMARY_REGEN_INTERVAL === 0;
}

// ---------------------------------------------------------------------------
// buildSummaryPrompt
// Assembles the prompt sent to the Summariser LLM.
// Called only when shouldSummarise() returns true.
// ---------------------------------------------------------------------------

export function buildSummaryPrompt(state: LegalAgentState): string {
  const allMessages = state.messages
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n");

  const lines: string[] = [];

  lines.push(
    "You are a legal case intake assistant reviewing a conversation transcript."
  );
  lines.push(
    "Summarise the conversation below for your own future reference in the same session."
  );
  lines.push("");
  lines.push("Your summary must cover:");
  lines.push(
    "1. The legal domain and specific issue type (criminal or civil, and subcategory)"
  );
  lines.push("2. The jurisdiction (US state or federal)");
  lines.push("3. Urgency level and any time-sensitive deadlines mentioned");
  lines.push("4. Key facts: what happened, when, where, who was involved");
  lines.push("5. The client's role in the matter");
  lines.push("6. Evidence and witnesses mentioned");
  lines.push("7. Insurance and financial details shared");
  lines.push("8. Any questions the client asked and what information was provided");
  lines.push("9. Whether a lawyer referral was offered and the client's response");
  lines.push("10. The current phase of the conversation and what has been resolved");
  lines.push("");
  lines.push("Rules:");
  lines.push("• Keep the summary under 200 words.");
  lines.push("• Write in plain prose — no bullet points.");
  lines.push("• Do not include legal analysis or predictions.");
  lines.push("• Do not invent facts not present in the conversation.");
  lines.push("• Preserve exact figures (amounts, dates, case numbers) if mentioned.");
  lines.push("");
  lines.push("CONVERSATION TRANSCRIPT:");
  lines.push(allMessages);
  lines.push("");
  lines.push("Your summary (under 200 words):");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Summariser LLM configuration
// ---------------------------------------------------------------------------

export const SUMMARY_LLM_CONFIG = {
  model: "gpt-4o-mini",
  temperature: 0,           // deterministic — we want a consistent summary
  max_tokens: SUMMARY_MAX_TOKENS,
} as const;

// ---------------------------------------------------------------------------
// parseSummaryResponse
// Extracts the plain text summary from the LLM response.
// The summary prompt requests plain prose — no JSON parsing needed.
// ---------------------------------------------------------------------------

export function parseSummaryResponse(raw: string): string {
  if (!raw || raw.trim() === "") {
    console.warn("[SummaryPromptCreator] Empty summary response");
    return "";
  }
  // Trim whitespace and any accidental markdown fencing
  return raw
    .trim()
    .replace(/^```[\s\S]*?```$/gm, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Summary template (markdown version — for reference and documentation)
// This is the human-readable equivalent of buildSummaryPrompt().
// Saved as prompts/summary_template.md by the build process.
// ---------------------------------------------------------------------------

export const SUMMARY_TEMPLATE_MARKDOWN = `
# Conversation Summary Prompt Template
# Runtime skill — loaded by summary_prompt_creator.ts every summarisation turn.

## System instruction
You are a legal case intake assistant reviewing a conversation transcript.
Summarise the conversation below for your own future reference in the same session.

## Summary requirements
Your summary must cover:
1. Legal domain and specific issue type (criminal or civil, and subcategory)
2. Jurisdiction (US state or federal)
3. Urgency level and any time-sensitive deadlines mentioned
4. Key facts: what happened, when, where, who was involved
5. Client's role in the matter
6. Evidence and witnesses mentioned
7. Insurance and financial details shared
8. Questions the client asked and information provided
9. Whether a lawyer referral was offered and client's response
10. Current phase and what has been resolved

## Rules
- Keep the summary under 200 words
- Write in plain prose — no bullet points
- Do not include legal analysis or predictions
- Do not invent facts not present in the conversation
- Preserve exact figures (amounts, dates, case numbers) if mentioned

## Template
CONVERSATION TRANSCRIPT:
{all messages formatted as ROLE: content}

Your summary (under 200 words):
`.trim();
