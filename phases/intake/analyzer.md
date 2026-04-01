# Phase 1 — Intake: Analyzer Instructions

## Goal
Identify the legal domain, specific issue type, jurisdiction, and urgency level from the client's
opening messages so the agent can route the conversation correctly from the very first turn.

---

## Fields to extract

```json
{
  "legalDomain": "criminal | civil | ''",
  "legalIssueType": "criminal-assault | criminal-dui | criminal-drug | criminal-theft | criminal-fraud | criminal-domestic-violence | criminal-homicide | criminal-sex-offense | criminal-white-collar | criminal-other | civil-personal-injury | civil-landlord-tenant | civil-employment | civil-contract | civil-family | civil-medical-malpractice | civil-property | civil-consumer | civil-civil-rights | civil-other | ''",
  "jurisdiction": "string — US state name or abbreviation, 'federal', or city if state is unclear. Return '' if not mentioned.",
  "urgencyLevel": "emergency | urgent | standard | exploratory | ''"
}
```

---

## Extraction rules

### legalDomain
- `criminal`: the state or federal government is prosecuting the client, OR the client has been
  arrested, charged, or is under investigation by law enforcement.
- `civil`: a dispute between private parties — injury, contract, employment, family, property.
- If the situation clearly involves both (e.g. domestic violence with a civil protective order AND
  criminal charges), choose `criminal` — it carries higher urgency.
- Return `''` only if the client has said nothing that indicates a domain.

### legalIssueType
Map what the client describes to the closest category:
- Arrest, charges, criminal court → prefix `criminal-`
- DUI / DWI / drunk driving → `criminal-dui`
- Drug possession, trafficking, distribution → `criminal-drug`
- Assault, battery, fighting → `criminal-assault`
- Theft, robbery, burglary, shoplifting → `criminal-theft`
- Fraud, forgery, identity theft → `criminal-fraud`
- Domestic violence, abuse, restraining order → `criminal-domestic-violence`
- Murder, manslaughter, vehicular homicide → `criminal-homicide`
- Sexual assault, rape, molestation → `criminal-sex-offense`
- Embezzlement, securities fraud, tax evasion → `criminal-white-collar`
- Any other criminal charge → `criminal-other`
- Car accident, slip and fall, injury → `civil-personal-injury`
- Landlord, tenant, eviction, lease → `civil-landlord-tenant`
- Wrongful termination, harassment, discrimination at work → `civil-employment`
- Breach of contract, business dispute → `civil-contract`
- Divorce, custody, child support → `civil-family`
- Doctor, hospital, surgical error → `civil-medical-malpractice`
- Property dispute, boundary, HOA → `civil-property`
- Consumer fraud, defective product → `civil-consumer`
- Police brutality, discrimination by government → `civil-civil-rights`
- If ambiguous within a domain, choose the `*-other` variant.
- Return `''` only if nothing can be inferred.

### jurisdiction
- Extract the US state name or standard abbreviation (e.g. "Texas", "TX", "California", "CA").
- If the client mentions "federal court" or a federal agency (FBI, DEA, IRS), return `"federal"`.
- If only a city is mentioned, return the city (e.g. "Chicago") — do not infer the state.
- NEVER infer jurisdiction from the client's name, accent, or phone number.
- Return `''` if not mentioned.

### urgencyLevel
- `emergency`: ANY of — active arrest or in custody right now; court hearing in less than 48 hours;
  active restraining order violation in progress; credible immediate threat to physical safety;
  bail hearing scheduled for today or tomorrow.
- `urgent`: court date or filing deadline within 2 weeks; eviction notice with a date within 2 weeks;
  bail not yet posted; imminent financial harm (wage garnishment starting, bank levy).
- `standard`: active legal matter but no imminent deadline mentioned.
- `exploratory`: client is asking hypothetically, researching options, or describing a past event
  with no current legal proceedings.
- When in doubt between `emergency` and `urgent`, choose `urgent` — the speaker will clarify.
- Return `''` if the client's very first message gives no clues.

### Never fabricate
- Do not invent a jurisdiction the client has not mentioned.
- Do not upgrade urgency based on the severity of the alleged crime alone — only timing signals
  (court dates, deadlines, active custody) determine urgency.
- Do not extract issue types from hypothetical examples the agent itself gave.

---

## Output
Return ONLY valid JSON matching the schema above. No preamble, no explanation.
