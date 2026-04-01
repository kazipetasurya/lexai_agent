# Summary Prompt Template
# Runtime reference — assembled dynamically by src/prompts/summary_prompt_creator.ts.
# Triggered when session message count exceeds 20, then every 10 turns thereafter.

---

## When summarisation runs

| Message count    | Action                                           |
|------------------|--------------------------------------------------|
| < 20             | No summarisation — use raw history               |
| 20 (first time)  | Generate summary; store in conversationSummary   |
| 30, 40, 50...    | Regenerate summary every 10 turns               |
| Any              | Analyzer never uses summary — last 6 msgs only  |

---

## Full prompt structure

```
You are a legal case intake assistant reviewing a conversation transcript.
Summarise the conversation below for your own future reference in the same session.

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

Rules:
• Keep the summary under 200 words.
• Write in plain prose — no bullet points.
• Do not include legal analysis or predictions.
• Do not invent facts not present in the conversation.
• Preserve exact figures (amounts, dates, case numbers) if mentioned.

CONVERSATION TRANSCRIPT:
USER: {message content}
ASSISTANT: {message content}
USER: {message content}
...
[all messages in state.messages]

Your summary (under 200 words):
```

---

## How the summary is used

Once generated, `state.conversationSummary` is stored and injected into
the Speaker prompt on subsequent turns:

```
CONVERSATION SUMMARY (earlier turns):
{conversationSummary}

CONVERSATION:
[last 8 messages]
```

The Analyzer never receives the summary — it extracts from the latest message only.

---

## LLM configuration

| Parameter        | Value        |
|------------------|--------------|
| Model            | gpt-4o-mini  |
| Temperature      | 0            |
| Max tokens       | 400          |
| Response format  | text         |

---

## Example summary output

```
The client is a defendant in a criminal DUI case in Austin, Texas. The incident occurred on
March 3rd outside a bar on 6th Street; the client failed a breathalyser test and was arrested.
Urgency is emergency as a court appearance is scheduled for tomorrow morning. The arresting
officer is the main party. The client has no prior legal history. A dashcam video from a nearby
vehicle may exist. No insurance claim has been filed. The client cannot afford a private
attorney and has been informed about public defender eligibility. The agent explained the
arraignment process and the right to remain silent. A referral to the public defender's office
was offered and accepted. The session is currently in the guidance phase with the referral
offer recorded. Two questions have been addressed: what happens at arraignment, and whether
the client should speak to police.
```

Total: 148 words. Under 200. Contains all key facts for session continuity.
