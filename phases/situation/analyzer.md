# Phase 2 — Situation: Analyzer Instructions

## Goal
Extract a detailed factual picture of what happened: the incident summary, date, location,
parties involved, the client's role, the sequence of events, any prior legal history, and
initial evidence observations.

---

## Fields to extract

```json
{
  "incidentSummary": "string — 1–3 sentence neutral summary of what the client says happened. Overwrite on each turn as details are refined. Return '' if nothing new.",
  "incidentDate": "string — date or time period of the incident as stated by the client (e.g. 'March 15 2024', 'last Tuesday', 'about 6 months ago'). Return '' if not mentioned.",
  "incidentLocation": "string — city, address, venue, or description of where the incident occurred. Return '' if not mentioned.",
  "partiesInvolved": "string[] — names, roles, or descriptions of other people involved (e.g. 'defendant John Smith', 'employer XYZ Corp', 'arresting officer'). Return [] if none mentioned.",
  "clientRole": "string — the client's role in the legal matter: 'defendant', 'plaintiff', 'victim', 'witness', 'accused', 'claimant', or a brief description. Return '' if unclear.",
  "timeline": "string — narrative sequence of key events as described by the client, in chronological order. Overwrite and expand each turn. Return '' if not enough detail yet.",
  "priorLegalAction": "boolean | null — true if the client mentions any prior arrests, charges, lawsuits, or legal proceedings related to this matter or a prior similar matter. null if not mentioned.",
  "priorLegalActionDetails": "string — brief description of prior legal action if priorLegalAction is true. Return '' otherwise.",
  "evidenceNoted": "string[] — quick notes on any evidence the client mentions: photos, videos, texts, emails, contracts, witnesses, medical records, receipts. Return [] if none mentioned."
}
```

---

## Extraction rules

### incidentSummary
- Write in neutral third-person: "Client states that..." or just describe the event directly.
- Do not add legal conclusions (e.g. do not say "Client was wrongfully arrested").
- Overwrite the previous summary each turn — refine and expand as the client shares more.
- Keep to 1–3 sentences.

### incidentDate
- Accept any date format the client uses — do not normalise or reformat.
- If the client says "last Tuesday" or "about three months ago", return that phrase verbatim.
- Return `''` if no date or time reference is given.

### partiesInvolved
- Include any person or entity the client mentions as involved: the other driver, the employer,
  the landlord, the arresting officer, the alleged victim, a co-defendant, etc.
- Use the client's own descriptions ("my ex-wife", "the store manager") if no name is given.
- Append to existing entries — do not replace the array.
- Return `[]` if no parties are newly mentioned this turn.

### clientRole
- Infer from context if not stated:
  - Client was arrested or charged → `"defendant"`
  - Client was injured or harmed → `"victim"` or `"plaintiff"` depending on domain
  - Client initiated a lawsuit → `"plaintiff"`
  - Client is describing someone else's arrest → `"witness"` or clarify
- Return `''` only if genuinely ambiguous after the client's description.

### timeline
- Build a running narrative from earliest event to most recent.
- Overwrite the whole field each turn with an improved, expanded version.
- Use the client's language — do not editorialize.
- Return `''` if the client has not yet described any sequence of events.

### priorLegalAction
- `true`: client mentions prior arrest, prior lawsuit, prior restraining order, prior criminal
  conviction, pending related case, or prior contact with law enforcement for the same matter.
- `null`: client has not mentioned anything about prior legal history.
- Never return `false` — only `true` or `null`. The speaker will ask if needed.

### evidenceNoted
- Extract any mention of physical, documentary, or digital evidence.
- Examples: "I have photos", "there's a police report", "I saved the text messages",
  "my doctor has records", "there's a security camera nearby."
- Keep each entry short (under 10 words).
- Append to existing entries.

### Never fabricate
- Do not invent parties, dates, or locations the client has not mentioned.
- Do not infer criminal intent or civil liability from the facts.
- Do not extract fields from hypothetical examples used by the agent.
- Do NOT extract SSN, date of birth, or financial account numbers even if the client mentions them.

---

## Output
Return ONLY valid JSON matching the schema above. No preamble, no explanation.
