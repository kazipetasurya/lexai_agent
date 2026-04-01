# Phase 3 — Insurance / Financial: Analyzer Instructions

## Goal
Determine whether the client has relevant insurance coverage, whether a claim has been filed,
the estimated financial impact of the situation, and whether the client can afford private
legal representation.

---

## Fields to extract

```json
{
  "insuranceCoverageType": "auto | homeowners | renters | health | liability | workers-comp | none | unknown | ''",
  "insuranceProvider": "string — name of the insurance company if mentioned. Return '' if not mentioned.",
  "insurancePolicyNumber": "string — policy number if stated by the client. Return '' if not mentioned. NEVER extract Social Security Numbers or bank account numbers.",
  "insuranceClaimFiled": "boolean | null — true if client says they have filed or are filing a claim. null if not mentioned.",
  "insuranceClaimNumber": "string — claim number if the client mentions one. Return '' if not mentioned.",
  "estimatedDamages": "string — client's own estimate of financial damages, medical costs, lost wages, property loss, bail amount, or legal fees. Use the client's words (e.g. '$10,000 in medical bills', 'about $5,000 property damage'). Return '' if not mentioned.",
  "financialExposure": "string — description of the financial stake (e.g. 'civil lawsuit seeking $50,000', 'bail set at $25,000', 'facing $200,000 judgment'). Return '' if not mentioned.",
  "canAffordAttorney": "boolean | null — true if client indicates they can pay for private legal representation. false if they say they cannot afford one or ask about free/low-cost options. null if the topic has not come up."
}
```

---

## Extraction rules

### insuranceCoverageType
Map to the closest category:
- Car accident, vehicle damage → `auto`
- Home damage, property claim → `homeowners` or `renters`
- Medical bills, hospital → `health`
- Business or personal liability → `liability`
- Injured at work → `workers-comp`
- Client explicitly says they have no insurance → `none`
- Client says they're not sure or doesn't know → `unknown`
- Return `''` only if insurance has not been discussed at all.

### insurancePolicyNumber
- Accept only if the client explicitly states it as a policy number.
- CRITICAL: If the value matches a Social Security Number pattern (XXX-XX-XXXX or 9 consecutive
  digits), return `''` — do not extract it under any circumstances.
- Do not prompt or encourage the client to share this unless the speaker asks for it.

### estimatedDamages
- Use the client's exact phrasing — do not normalise to a number.
- Include the type of damage if mentioned: medical, property, lost wages, bail, legal fees.
- For criminal cases, this may be bail amount or restitution demanded.
- Return `''` if no financial figure or estimate has been mentioned.

### canAffordAttorney
- `true`: client says they can pay, has a retainer, or has funds available for an attorney.
- `false`: client says they can't afford one, asks about free lawyers, asks about public
  defenders, asks about legal aid, or asks "how much does a lawyer cost?"
- `null`: the topic of affording an attorney has not come up.
- Never infer from income, job status, or financial damages mentioned.

### Never fabricate
- Do not assume insurance coverage from the type of incident.
- Do not invent policy numbers, claim numbers, or damage estimates.
- Do NOT extract Social Security Numbers, bank account numbers, or dates of birth.
- Do not extract financial account numbers under any label.

---

## Output
Return ONLY valid JSON matching the schema above. No preamble, no explanation.
