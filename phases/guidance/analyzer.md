# Phase 5 — Guidance: Analyzer Instructions

## Goal
Track which questions the client has asked and what information has been provided, detect
when the client indicates satisfaction or wishes to stop, and determine whether a lawyer
referral is needed and whether the client accepts it.

---

## Fields to extract

```json
{
  "questionAsked": "string — the single most important question or topic the client raised THIS turn, in brief (under 15 words). Return '' if the client did not ask a question.",
  "infoProvided": "string — a brief label for the information the agent provided in the PREVIOUS turn (e.g. 'explained right to remain silent', 'described small claims process', 'outlined statute of limitations for personal injury'). Return '' if this is the first guidance turn.",
  "referralNeeded": "boolean | null — true if the client's situation clearly requires a licensed attorney (complexity, criminal charges, high damages, ongoing proceedings). null if not yet determinable.",
  "referralAccepted": "boolean | null — true if the client explicitly agrees to be connected with an attorney or asks for one. false if the client explicitly declines. null if the question has not been asked or answered.",
  "userSatisfied": "boolean | null — true if the client says they have what they need, thank you, or similar closing signal. false if the client expresses frustration or says their question wasn't answered. null if satisfaction has not been signalled."
}
```

---

## Extraction rules

### questionAsked
- Extract the core topic of the client's most recent question.
- Use plain language: "what happens at arraignment", "can I sue for lost wages",
  "do I need a lawyer for a DUI".
- If the client made a statement rather than asking a question, return `''`.
- Extract only the topic from THIS turn — do not re-extract questions from earlier turns.

### infoProvided
- Look at the ASSISTANT message just before the client's current message.
- Summarise in 5–10 words what topic the agent addressed.
- Examples: "explained right to remain silent", "described civil lawsuit process",
  "outlined landlord obligations under state law", "described public defender eligibility."
- Return `''` on the very first guidance turn (no prior assistant message in this phase).

### referralNeeded
- `true` when ANY of the following apply:
  - Criminal charge of any kind (always recommend attorney)
  - Civil damages above $10,000
  - Ongoing court proceedings
  - Client mentions they have been served with legal documents
  - Domestic violence or restraining order involved
  - Medical malpractice allegation
  - Employment discrimination claim
  - Client expresses confusion about what to do next
- `null` if the situation is still being assessed.
- Note: For criminal cases, `referralNeeded` should almost always be `true`.

### referralAccepted
- `true`: client says "yes", "sure", "please", "I'd like that", "can you connect me",
  or any positive response to being connected with a lawyer.
- `false`: client says "no thanks", "I just wanted information", "I'll handle it myself",
  "not right now", or similar.
- `null`: the referral offer has not yet been made or the client has not responded to it.

### userSatisfied
- `true`: "thanks", "that's helpful", "I think I understand now", "I have what I need",
  "that answers my question", or any clear signal they are done asking questions.
- `false`: "that didn't help", "I'm still confused", "you didn't answer my question",
  or expressions of frustration.
- `null`: no clear satisfaction signal either way.

### Never fabricate
- Do not extract a referralAccepted value unless the client has explicitly responded to
  a referral offer.
- Do not mark userSatisfied as true just because the client stopped asking questions —
  wait for an explicit positive signal.

---

## Output
Return ONLY valid JSON matching the schema above. No preamble, no explanation.
