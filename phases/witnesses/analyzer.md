# Phase 4 — Witness & Evidence Inventory: Analyzer Instructions

## Goal
Build a structured inventory of known witnesses and evidence items, confirm whether a police
report exists, and establish who currently holds key evidence.

---

## Fields to extract

```json
{
  "witnesses": [
    {
      "name": "string — witness name, or 'unknown' / 'unnamed bystander' if identity not known",
      "type": "eyewitness | expert | character | other",
      "contactAvailable": "boolean | null — true if client says they have contact info, null if unknown",
      "notes": "string — any additional detail the client mentions about this witness"
    }
  ],
  "evidenceItems": [
    {
      "description": "string — what the evidence is, in the client's words",
      "type": "photo | video | document | physical | digital | testimony | other",
      "inPossession": "boolean | null — true if the client currently has this evidence, null if unclear",
      "notes": "string — any additional context (e.g. 'stored on phone', 'with police', 'at hospital')"
    }
  ],
  "policeReportFiled": "boolean | null — true if a report was filed. null if not yet mentioned.",
  "policeReportNumber": "string — report number if the client mentions one. Return '' if not mentioned.",
  "hasDigitalEvidence": "boolean | null — true if client mentions texts, emails, photos, videos, social media posts, or any digital content. null if not discussed.",
  "evidenceCustody": "string — who currently holds or controls key evidence (e.g. 'client has photos on phone', 'police seized the vehicle', 'hospital has medical records'). Return '' if not discussed."
}
```

---

## Extraction rules

### witnesses array
- Create a new entry for each distinct witness the client mentions.
- Append to the existing array — do not replace it.
- Witness types:
  - `eyewitness`: saw or heard the incident directly
  - `expert`: medical professional, accident reconstructionist, forensic specialist
  - `character`: someone who can speak to the client's reputation or history
  - `other`: any other type (lawyer, employer, family member in a supporting role)
- If the client says "there were a couple of people around but I don't know who they are",
  create one entry: `{ "name": "unknown bystanders", "type": "eyewitness", "contactAvailable": false, "notes": "unidentified" }`
- Return `[]` if no new witnesses are mentioned this turn.

### evidenceItems array
- Create a new entry for each distinct piece of evidence mentioned.
- Append to the existing array — do not replace it.
- Evidence types:
  - `photo`: photographs (on phone, printed, CCTV stills)
  - `video`: video footage (phone, dashcam, CCTV, bodycam)
  - `document`: written records — contracts, leases, medical records, receipts, police reports
  - `physical`: tangible objects — damaged property, clothing, weapons (described, not uploaded here)
  - `digital`: texts, emails, social media posts, app data, GPS records
  - `testimony`: a witness's verbal account (not yet a formal statement)
  - `other`: anything else
- If the client uploaded a photo or video (check uploadedFiles), do NOT create a duplicate
  entry — the upload is already tracked.
- Return `[]` if no new evidence items are mentioned this turn.

### policeReportFiled
- `true`: client confirms a report was filed by them or law enforcement.
- `null`: not yet discussed.
- Never return `false` — only `true` or `null`. The speaker will ask directly.

### hasDigitalEvidence
- `true`: client mentions texts, emails, photos, videos, voicemails, social media, GPS data,
  app records, or any digital content — whether they have it or not.
- `null`: digital evidence has not been mentioned.

### evidenceCustody
- Free text describing who controls key evidence.
- If multiple parties hold different items, list them:
  "Client has phone photos; police have the vehicle; hospital has medical records."
- Return `''` if not discussed.

### Never fabricate
- Do not invent witnesses or evidence items the client has not mentioned.
- Do not infer that a police report was filed just because the issue involves law enforcement.
- Do not extract financial account numbers or SSNs even if the client shares them here.

---

## Output
Return ONLY valid JSON matching the schema above. No preamble, no explanation.
