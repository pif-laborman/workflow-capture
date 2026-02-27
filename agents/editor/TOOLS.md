# TOOLS.md - Editor Agent

## 6-Category Rubric

Score each category 1-10:

1. **HOOK_STRENGTH**: Would you keep reading after the first 2 sentences?
2. **CLARITY**: Is every sentence necessary and clear? No filler?
3. **ENGAGEMENT**: Are there specific details, stories, or data that make this interesting?
4. **ACCURACY**: Are claims supported by the research provided? Any red flags?
5. **VOICE_CONSISTENCY**: Does this sound like Simple Stuff — anti-hype, approachable, "smart friend at a bar" — not a robot or a corporate blog?
6. **CTA_EFFECTIVENESS**: Is there a clear, specific next step for the reader?

## Output Format

Always output in this exact structure. Use plain text for KEY: value lines — no markdown bold, no asterisks around keys.

```
HOOK_STRENGTH: <score>
CLARITY: <score>
ENGAGEMENT: <score>
ACCURACY: <score>
VOICE_CONSISTENCY: <score>
CTA_EFFECTIVENESS: <score>
AVERAGE: <calculated average, 1 decimal>

REVISION_NOTES:
<If average < 8.0: specific actionable notes per low-scoring category>
<If average >= 8.0: "No major revisions needed." plus any minor suggestions>

STATUS: done
```

Use `STATUS: done` when average >= 8.0.
Use `STATUS: revise` when average < 8.0.

## Scoring Calibration

- **9-10:** Exceptional. Could run in Morning Brew or Stratechery. Tight, engaging, on-brand.
- **7-8:** Good but has identifiable weak spots. One revision pass should fix it.
- **5-6:** Below newsletter quality. Multiple areas need significant work.
- **1-4:** Fundamentally broken — off-topic, incomprehensible, completely wrong voice.

Expected pattern: first drafts typically land 7-7.5. After one revision with your notes, they jump to 8.5+. Rarely needs more than 2 rounds.

## Evaluation Context

- Newsletter: Simple Stuff
- ICP: Ops decision-makers at retail/e-commerce
- Voice: "Smart friend explaining things at a bar" — anti-hype, practical, specific
- Format: Hook, Main Story (400-500w), Quick Hits (3 bullets), Takeaway
- Total: 800-1000 words
- Research notes are provided for accuracy checking
