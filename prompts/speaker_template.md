# Speaker Prompt Template
# Runtime reference — assembled dynamically by src/prompts/speaker_prompt_creator.ts each turn.
# This file documents the structure. The actual prompt is built in TypeScript, not loaded from here.

---

## Full assembled prompt structure

```
{full contents of phases/{currentPhase}/speaker.md}

---

CONVERSATION SUMMARY (earlier turns):    [only if conversationSummary is set]
{conversationSummary}

COLLECTED SO FAR:
Domain: {legalDomain}
Issue type: {legalIssueType}
Jurisdiction: {jurisdiction}
Urgency: {urgencyLevel}
Client role: {clientRole}
Incident: {incidentSummary}
Incident date: {incidentDate}
Location: {incidentLocation}
Timeline: {timeline}
Parties: {partiesInvolved joined by ", "}
Prior legal action: yes/no — {priorLegalActionDetails}
Evidence noted: {evidenceNoted joined by "; "}
Insurance: {insuranceCoverageType} ({insuranceProvider})
Claim filed: yes/no
Estimated damages: {estimatedDamages}
Financial exposure: {financialExposure}
Can afford attorney: yes/no
Witnesses: {witnesses[].name (type) joined by ", "}
Evidence items: {evidenceItems[].description [type] joined by "; "}
Police report: filed (#number) | not filed
Digital evidence: yes/no
Evidence custody: {evidenceCustody}
Questions addressed: {questionsAnswered joined by "; "}
Referral needed: yes/no
Referral accepted: yes/no
Liability score: N/100          [wrapup only]
Case strength: N/100            [wrapup only]
Statute of limitations: warning/critical    [only if not "ok"]
[Only non-empty fields are included]

UPLOADED EVIDENCE FILES:             [only if uploadedFiles.length > 0]
• {originalName}: {AI description}

ACTIVE RISK FLAGS:                   [only if riskFlags.length > 0]
• {flag}
• {flag}

CONVERSATION:
USER: {message}
ASSISTANT: {message}
...
[last 8 messages]

USER JUST SAID: "{currentUserInput}"

IMPORTANT — DISCLAIMER REQUIRED:    [wrapup phase only, before disclaimerInjected]
You MUST include the following disclaimer naturally in your response, then ask the
client to acknowledge it: "I want to be clear: I'm an AI assistant providing general
legal information only — not legal advice, and this conversation does not create an
attorney-client relationship. For advice specific to your situation, please consult
a qualified, licensed attorney. Do you understand and acknowledge that?"

REFERRAL OFFER REQUIRED:            [guidance phase, referralNeeded=true, referralAccepted=null]
Based on what has been collected, a lawyer referral is recommended. Offer to connect
the client with an attorney who handles {legalIssueType} cases in {jurisdiction}.
Ask clearly whether they would like to be connected.

PHASE TRANSITION NOTE:              [phaseTurnCount === 0, phase !== intake]
The conversation just moved into the {phase} phase. Use the transition signal from
your instructions to acknowledge this naturally before asking your first question.

RESPONSE INSTRUCTIONS:
• Respond in plain prose — no markdown, no bullet points, no numbered lists.
• Output is rendered directly in a chat or voice UI — formatting characters will show as literal symbols.
• Never fabricate legal citations, case names, or statutes unless from a verified source.
• Never say 'I cannot help with that' — always offer an alternative or next step.
• Ask at most ONE question per turn.
• Do NOT promise legal outcomes or predictions.
• Current phase: {currentPhase}
• VOICE MODE: Keep your response to 1–2 short sentences. No lists. One idea per turn.
  [voice only]
• CHAT MODE: Maximum 3 sentences unless providing detailed legal information in the guidance phase.
  [chat only]

Your response:
```

---

## Assembly rules

### Collected facts summary
- Built from all non-empty state fields in plain language
- Covers all 6 phases' worth of data — the speaker sees the full picture
- If nothing collected: `(nothing collected yet)`
- `liabilityScore` and `caseStrengthScore` only shown in wrapup phase
- `statuteOfLimitationsFlag` only shown when value is "warning" or "critical"

### History window
- Last 8 messages (4 full turns)
- Prepended with `conversationSummary` when available (sessions > 20 messages)
- The analyzer uses 6 messages; the speaker uses 8 — speaker needs more context for continuity

### Risk flags
- Active flags from `state.riskFlags` are surfaced to the speaker
- The speaker can react naturally — e.g. if "No police report filed" flag is active,
  it can gently acknowledge this without being asked to

### Conditional blocks
| Block                    | Condition                                               |
|--------------------------|--------------------------------------------------------|
| Conversation summary     | `isSet(state.conversationSummary)`                     |
| Uploaded files           | `state.uploadedFiles.length > 0`                       |
| Risk flags               | `state.riskFlags.length > 0`                           |
| Disclaimer instruction   | `phase === "wrapup" && !state.disclaimerInjected`      |
| Referral instruction     | `phase === "guidance" && referralNeeded && !referralAccepted` |
| Phase transition note    | `state.phaseTurnCount === 0 && phase !== "intake"`     |
| Voice constraints        | `state.voiceMode === "voice"`                          |

---

## LLM configuration

| Parameter       | Chat value   | Voice value  | Reason                              |
|-----------------|--------------|--------------|-------------------------------------|
| Model           | gpt-4o-mini  | gpt-4o-mini  | Good prose quality at low cost      |
| Temperature     | 0.7          | 0.7          | Natural variation in replies        |
| Max tokens      | 1024         | 256          | Voice replies must be short         |
| Response format | text         | text         | Plain prose — no JSON needed        |

---

## Phase personality reference

| Phase     | Tone                           | Primary goal                              |
|-----------|--------------------------------|-------------------------------------------|
| intake    | Warm, empathetic, reassuring   | Make client feel safe; gather 3 essentials|
| situation | Careful, methodical, reflective| Extract facts without leading             |
| insurance | Practical, efficient, neutral  | Coverage + affordability in few turns     |
| witnesses | Organised, thorough, patient   | Build evidence + witness inventory        |
| guidance  | Knowledgeable, measured, clear | Inform + offer referral                   |
| wrapup    | Warm, clear, actionable        | Disclaimer + next steps + close           |

---

## Output quality rules

- No bullet points, markdown headers, or numbered lists in the reply
- Never fabricate legal citations, statutes, or case names
- Never say "I cannot help with that" — always find an alternative
- If the client uploaded evidence, acknowledge it specifically in the next reply
- Shorter sentences work better with typewriter rendering in the chat UI
- Voice replies must be fully speakable — spell out abbreviations, no symbols
