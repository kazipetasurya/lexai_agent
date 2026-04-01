# Analyzer Prompt Template
# Runtime reference — assembled dynamically by src/prompts/analyzer_prompt_creator.ts each turn.
# This file documents the structure. The actual prompt is built in TypeScript, not loaded from here.

---

## Full assembled prompt structure

```
You are a precise data extractor for a legal intake agent.
Your only job is to extract structured data from what the client just said.
Never invent or infer values the client has not explicitly stated.

PHASE: {CURRENT_PHASE} | TURN: {phaseTurnCount + 1} of {maxTurns}
LEGAL DOMAIN: {legalDomain | "not yet determined"}
URGENCY: {urgencyLevel | "not yet determined"}

RECENT CONVERSATION:
USER: {message}
ASSISTANT: {message}
USER: {message}
ASSISTANT: {message}
USER: {message}
ASSISTANT: {message}
[last 6 messages maximum]

USER JUST SAID:
"{currentUserInput}"

UPLOADED EVIDENCE FILES:             [only if uploadedFiles.length > 0]
• {originalName}: {AI description}
• {originalName}: {AI description}

NOTE: This is the final turn of the {phase} phase. Extract whatever partial
information is available — do not leave fields empty just because the client's
answer is incomplete.
[only when turnsRemaining <= 1]

--- EXTRACTION INSTRUCTIONS ---

{full contents of phases/{currentPhase}/analyzer.md}
```

---

## Assembly rules

### History window
- Last 6 messages (3 full turns) maximum
- Format: `USER: ...` / `ASSISTANT: ...` on separate lines
- Include all messages if fewer than 6 exist

### Phase and turn context
- Always show `PHASE`, `TURN`, `LEGAL DOMAIN`, and `URGENCY`
- Domain and urgency give the LLM routing context for ambiguous inputs

### Uploaded files block
- Only included when `state.uploadedFiles.length > 0`
- Each entry: `• {originalName}: {AI-generated description}`
- Photos and videos only for this agent

### Final-turn extraction note
- Injected when `turnsRemaining <= 1` (i.e. `phaseTurnCount + 1 >= maxTurns`)
- Instructs the LLM to extract partial values rather than defaulting to empty strings
- Prevents data loss at phase boundary turns

### Phase instructions
- Loaded from `phases/{phase}/analyzer.md` verbatim
- Contains: Goal, Fields to extract, Extraction rules, Output instruction

---

## LLM configuration

| Parameter        | Value                           |
|------------------|---------------------------------|
| Model            | gpt-4o-mini                     |
| Temperature      | 0 (deterministic)               |
| Max tokens       | 512                             |
| Response format  | { type: "json_object" }         |

---

## Error handling

If the LLM returns unparseable output:
1. Log raw output with turn number and phase
2. Return `{}` (empty object)
3. Orchestrator merges nothing — no state change
4. Turn still proceeds — speaker asks a natural follow-up
5. `phaseTurnCount` still increments — no infinite loops

---

## Good vs bad extraction examples

### Intake phase — good
User: "I was arrested last night in Austin for a DUI. My court date is tomorrow morning."

```json
{
  "legalDomain": "criminal",
  "legalIssueType": "criminal-dui",
  "jurisdiction": "Texas",
  "urgencyLevel": "emergency"
}
```

### Intake phase — bad (cross-phase contamination)
```json
{
  "legalDomain": "criminal",
  "legalIssueType": "criminal-dui",
  "jurisdiction": "Texas",
  "urgencyLevel": "emergency",
  "incidentSummary": "Client was arrested for DUI",
  "partiesInvolved": ["arresting officer", "client"]
}
```
`incidentSummary` and `partiesInvolved` belong to the situation phase. Never extract them here.

### Situation phase — good
User: "It happened on March 3rd outside a bar on 6th Street. The officer said I failed the breathalyser."

```json
{
  "incidentSummary": "Client failed breathalyser test outside a bar on 6th Street",
  "incidentDate": "March 3rd",
  "incidentLocation": "6th Street, Austin",
  "partiesInvolved": ["arresting officer"],
  "clientRole": "defendant",
  "timeline": "March 3rd: Client outside bar on 6th Street; officer administered breathalyser; client failed; arrested.",
  "priorLegalAction": null,
  "evidenceNoted": []
}
```
