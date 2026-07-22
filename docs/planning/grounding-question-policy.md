# Grounding question policy

**Status:** Implemented (template selection + approved wording).

Optional capture cards and grounding conversations both persist into `user_grounding_profile`. This document defines **when** we may ask, **how** questions should sound, and **what** answers are for.

The Capture card slot is shared with **relevance check-ins** (same cadence). Prefer a grounding blank when one exists; otherwise see [`relevance-checkin-policy.md`](./relevance-checkin-policy.md).

Related: [`grounding-onboarding.md`](./grounding-onboarding.md) (onboarding chat), [`qa-grounding-hardening.md`](./qa-grounding-hardening.md) (profile use at answer time).

---

## Purpose

Grounding questions exist to help Eigen **classify captures, resolve entities, and retrieve with context** — not to perform intimacy, therapy, or personality quizzes.

Answers are supplementary enrichment context (`groundingProfilePromptBlock()` on ingest). They must make the user's **real life** easier to interpret: where they work, who matters, how they spend time, what they're building.

---

## Non-negotiable rules

### 1. Never ask just to ask

Every question must fill a **specific blank** — something captures alone have not resolved and enrichment would benefit from knowing.

Four gates (all must pass):

| Gate           | Question                                                              |
| -------------- | --------------------------------------------------------------------- |
| **Blank**      | Is there a concrete unknown? (Not "we know little about identity.")   |
| **Evidence**   | Did recent captures or failed resolution surface the gap?             |
| **Utility**    | Would the answer change classification, entity linking, or retrieval? |
| **Askability** | Can the user answer in one or two plain sentences without performing? |

If any gate fails → **skip**. Silence is better than noise.

### 2. Sound like a person, not a product

Questions must be things **people actually ask each other** when they're getting to know someone — at dinner, on a walk, early in a friendship.

**Ask like this:**

- Where do you work?
- Do you normally take the train home, or drive?
- Do you ride a bike much?
- Do you have kids?
- What do you do in your spare time?
- What kind of music are you into?

**Never ask like this:**

- In which life domains do you operate?
- What's the story behind your name, and how has it shaped how you connect with others?
- Tell me about your journey.
- What are your core values?
- How would you describe your relationship with yourself?

No coaching-app voice. No academic framing ("domains," "identity narrative," "values alignment"). No double-barreled therapy homework.

### 3. Anchor in the user's life, not abstractions

Psychology research (life domains, social identity, possible selves, basic values) informs **what kinds of blanks matter** — work, people, routines, pursuits, tastes. It does **not** authorize jargon or performative depth.

Use research to choose **topic areas**. Use everyday language for **wording**.

### 4. Show why we're asking (when the blank is visible)

When the gap comes from captures, tie the question to what Eigen already saw:

- _"You mention SPACE a lot — is that where you work?"_
- _"When you write 'Alex,' do you mean yourself or someone else?"_

When onboarding and no captures exist yet, a simple standalone question is fine (_"Where do you work?"_) — still concrete, still one thing at a time.

### 5. Default to skip

If recent captures give no useful angle → do not invent a question. Optional prompts are not a content calendar.

---

## What we're trying to learn (plain language)

These map to facet keys in [`src/lib/server/grounding/constants.ts`](../../src/lib/server/grounding/constants.ts) but **must not be asked using facet labels**.

| We want to understand…  | Everyday question examples                                         | Facet (internal)      |
| ----------------------- | ------------------------------------------------------------------ | --------------------- |
| Work and workplace      | Where do you work? What do you do for a living?                    | `work`                |
| Daily rhythm and place  | What does a normal weekday look like? Where are you usually based? | `routines`            |
| Commute and movement    | Do you take the train, drive, or bike?                             | `routines`            |
| Household and family    | Do you have kids? Who do you live with?                            | `relationships`       |
| People in their life    | Who is [name] — colleague, friend, family?                         | `relationships`       |
| Free time and interests | What do you do in your spare time? What kind of music do you like? | `routines` / `values` |
| What they're building   | What's the main thing you're working on right now?                 | `projects`            |
| Self vs others in text  | When you say "I" or [first name], is that you?                     | `identity`            |

**Demote or avoid** open-ended `psychology` questions ("how do you think about…", "what motivates you deep down"). If the blank is practical, ask practically.

---

## Good vs bad examples

| Bad                                                   | Why                                    | Better (if blank exists)                                    |
| ----------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| What's the story behind your name?                    | No enrichment utility; performative    | Are you the Alex in your captures, or someone else?         |
| How has your name shaped how you connect with others? | Therapy cosplay; unanswerable honestly | _(skip)_                                                    |
| Which domains do you operate in?                      | Academic; nobody speaks this way       | Where do you work?                                          |
| Tell me about your values                             | Vague; invites essay                   | Do you mostly capture tasks, ideas, or personal notes here? |
| What moves you?                                       | Coaching brochure                      | What do you do in your spare time?                          |
| What's your narrative identity?                       | Research jargon                        | What are you trying to get done this year?                  |

---

## Research foundation (why these topics, not this wording)

Brief pointers for implementers — not prompts to paste into the UI.

- **Life domains & boundaries** (Clark work–family border theory; Vanderweele flourishing): work, home, health, community are separable contexts; captures mean different things in each.
- **Social identity** (Tajfel & Turner): people define themselves through groups and roles — employer, team, family, profession.
- **Possible selves** (Markus & Nurius): specific near-term pursuits and goals motivate action; ask concretely ("what are you working on?"), not vaguely ("who do you want to become?").
- **Basic values** (Schwartz): motivational priorities exist cross-culturally; infer from behavior when possible; only ask when classification stays ambiguous.
- **Self-disclosure** (social penetration theory; disclosure-sequence research): purpose justification and low-invasiveness first increase honest answers; invasive or purposeless questions reduce trust.

Eigen uses this literature to decide **which blanks are worth filling**. Wording stays **everyday human**.

---

## Implementation

Optional capture cards call `generateCheckInQuestion()` (grounding first, then relevance):

1. For grounding: LLM selects an approved `templateId` (and optional `anchor` from captures) or returns `skip`.
2. [`question-templates.ts`](../../src/lib/server/grounding/question-templates.ts) builds the final question text — no free-form LLM wording.
3. Invalid template, missing required anchor, or skip → try relevance / no card shown.

Code touchpoints:

- [`src/lib/server/grounding/next-check-in.ts`](../../src/lib/server/grounding/next-check-in.ts) — shared check-in entry
- [`src/lib/server/grounding/next-question.ts`](../../src/lib/server/grounding/next-question.ts) — grounding template selection
- [`src/lib/server/grounding/question-templates.ts`](../../src/lib/server/grounding/question-templates.ts) — approved questions
- [`src/lib/components/grounding-question-card.svelte`](../../src/lib/components/grounding-question-card.svelte) — UI copy

---

## Review checklist

Before shipping a new grounding question path:

- [ ] Does it fill a documented blank, or is it "just to ask"?
- [ ] Would a normal person ask this out loud to a new friend?
- [ ] Is it free of domain jargon ("life domains," "identity narrative," "values journey")?
- [ ] Can the user answer in one or two sentences?
- [ ] Would the answer change ingest or retrieval behavior?
- [ ] If the blank isn't visible in captures yet, is the question still concrete (e.g. "Where do you work?") rather than abstract?
