# Phase 6 — Wrap-up: Analyzer Instructions

## Goal
Confirm that the legal disclaimer has been acknowledged, capture any final next steps
communicated to the client, and record when the session is closed.

---

## Fields to extract

```json
{
  "userAcknowledgedDisclaimer": "boolean — true ONLY if the client explicitly acknowledges or confirms they understand the disclaimer (e.g. 'I understand', 'yes', 'got it', 'ok', 'noted'). Return false if not yet confirmed.",
  "nextStepsProvided": "string[] — each distinct next step or action item the agent mentioned in the PREVIOUS assistant turn. Use short labels (e.g. 'contact public defender office', 'file police report', 'preserve digital evidence', 'consult personal injury attorney'). Return [] if no new next steps were given.",
  "sessionClosed": "boolean — true only if the client explicitly ends the session (e.g. 'goodbye', 'thank you, that's all', 'we're done'). Return false otherwise."
}
```

---

## Extraction rules

### userAcknowledgedDisclaimer
- Only mark `true` when the client has clearly responded to the disclaimer statement.
- Acceptable acknowledgements: "I understand", "yes", "ok", "got it", "sure", "noted",
  "that makes sense", or any affirmative response that follows the disclaimer being read.
- Do NOT mark `true` if the client says something unrelated after the disclaimer is shown.
- Do NOT mark `true` proactively — the speaker must have delivered the disclaimer first.

### nextStepsProvided
- Look at the PREVIOUS assistant message for action items.
- Extract each distinct recommended action as a short label.
- Append to existing entries — do not replace the array.
- Examples of valid entries:
  - "contact public defender office"
  - "file police report within 48 hours"
  - "preserve all text messages and photos"
  - "schedule consultation with employment attorney"
  - "request medical records from hospital"
  - "contact legal aid society for free consultation"
- Return `[]` if no next steps were included in the previous agent message.

### sessionClosed
- `true` only on an explicit farewell from the client.
- Do not infer session closure from the client going quiet or giving a short reply.
- Return `false` in all ambiguous cases.

### Never fabricate
- Do not mark `userAcknowledgedDisclaimer` true based on the client answering a different
  question — it must follow the disclaimer specifically.
- Do not invent next steps that the agent did not actually provide.

---

## Output
Return ONLY valid JSON matching the schema above. No preamble, no explanation.
