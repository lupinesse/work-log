# Claude Code Token Optimization Guidelines

## Core Principle

Treat tokens as ephemeral working memory.
Every unnecessary line:

- reduces reasoning quality
- increases latency
- accelerates session exhaustion
- contaminates future inference passes

Optimize for:

1. High signal density
2. Minimal historical drag
3. Deterministic workflows
4. Reusable context boundaries

---

## 1. Prefer Repository-Native Automation Over Conversational Instructions

This repository already exposes structured AI workflows through:

- `.claude/skills/` (each skill has its own `SKILL.md` brief)
- `CLAUDE.md` (project quality standard — repo root)
- `ARCHITECTURE.md` (architecture constraints — repo root)

These should act as the primary context-loading mechanism.

**Rules**

Invoke custom skills directly:

```bash
/ci-fix
/pr-review
/qa-review
```

Avoid:

- re-explaining review criteria
- manually describing CI repair flows
- repeating repository conventions
- re-documenting architecture constraints

The skill files already encode this information with significantly lower token
overhead.

### Centralize persistent instructions

Stable rules belong in `CLAUDE.md`, `ARCHITECTURE.md`, or the relevant
`.claude/skills/<name>/SKILL.md`. Do not continuously restate formatting
conventions, naming rules, stack details, testing expectations, or
architectural boundaries. Reference them briefly instead:

> "Follow existing repository architecture constraints."

---

## 2. Use Proactive Context Compression

### The 60% Compaction Rule

Run `/compact` around ~60% context utilization. Do **not** wait until context
warnings appear, responses degrade, reasoning becomes repetitive, or
hallucinated assumptions begin accumulating. Late-stage compaction produces
weaker summaries because the model is already operating under degraded context
conditions.

### Always compact with scope instructions

Bad:

```bash
/compact
```

Good:

```bash
/compact Preserve:
- active file scopes
- unresolved CI failures
- current auth refactor decisions
- agreed state-management approach
```

The quality of the compaction directive directly impacts future reasoning
continuity.

---

## 3. Maximize Signal Density

### Never paste entire files unnecessarily

Prefer:

> "Inspect `src/js/03-timer.js`"

Or:

> "Focus on `refreshAccessToken()` in `src/auth/jwt.ts`"

Avoid full-file pastes, duplicate code excerpts, and repeated stack traces.
Claude's filesystem tooling retrieves context more efficiently than manual
pasting.

### Strip logs aggressively

Only provide the failing assertion, relevant stack frame, and minimal
reproduction output. Avoid full build cascades, package installation logs,
successful test output, and unrelated warnings.

Good:

```text
TypeError: Cannot read property 'token' of undefined
src/auth/jwt.ts:144
```

Bad: entire 2,000-line CI transcript.

### Enforce planning mode before generation

For non-trivial work, separate reasoning from implementation:

> "Analyze the trace and produce 3 concise root-cause hypotheses. Do not
> modify files yet."

This prevents expensive speculative rewrites.

---

## 4. Control Generation Scope

### Prefer patches over rewrites

Request unified diffs, targeted patches, and isolated function edits. Avoid
regenerating full modules, rewriting large components, or re-outputting
unchanged code.

Good: "Patch only the reducer logic."  
Bad: "Rewrite the entire file."

### Chunk large workstreams

Never ask Claude to refactor an entire monorepo at once, review dozens of
files simultaneously, or redesign architecture in a single pass. Use phased
execution:

1. map subsystem
2. identify fault boundary
3. modify isolated layer
4. validate
5. continue incrementally

Smaller reasoning scopes consistently outperform massive contexts.

---

## 5. Maintain Session Hygiene

### Run `/clear` between unrelated domains

Switching between backend debugging, CSS cleanup, and infrastructure work
without clearing context creates cross-domain token pollution. Use `/clear`
between unrelated tasks.

### Start a fresh session after each PR merge

By the time a PR merges, context is typically 80–90% full of resolved findings,
superseded hypotheses, and CI output that no longer matters. Every turn in the
next task sends that entire dead history as input. Run `/clear` immediately
after a PR merges before starting the next task — this is the single highest-
leverage hygiene habit for multi-PR sessions.

### Monitor CI externally — never inside Claude

Running `gh pr checks <N> --watch` inside a Claude session burns tokens at
every polling interval with zero reasoning value. A 6-minute check cycle at
30-second resolution = ~12 turns × ~20k tokens each = ~240k tokens wasted on
waiting. Run `gh pr checks <N> --watch` directly in your terminal and return
to Claude only when there is something concrete to act on.

### Detect poisoned debugging loops early

If 3–4 consecutive fixes fail, the session history is likely contaminated by
incorrect assumptions — Claude begins reinforcing invalid reasoning pathways.

Recovery workflow:

1. summarize confirmed findings
2. save summary externally
3. run `/clear`
4. restart from clean context

Fresh reasoning frequently outperforms continuing inside degraded history.

---

## 6. Structure Requests Deterministically

Use compact, structured prompts:

```text
Goal:
Constraints:
Relevant files:
Observed behavior:
Current hypothesis:
Desired output:
```

Avoid vague prompts like "Take a look at this issue." Structured prompts
reduce exploratory reasoning overhead.

---

## 7. Minimize Redundant Re-analysis

Claude continuously re-processes visible conversation history. Avoid
repeatedly asking "What else?", "Any more ideas?", or "Re-analyze
everything." Instead, constrain the next reasoning step, build
incrementally, and reference previous conclusions explicitly.

Good: "Hypothesis #2 failed. Continue investigating cache invalidation."  
Bad: "Start over and rethink the whole system."

---

## 8. Treat Documentation as Externalized Memory

Well-structured repository documentation dramatically reduces token
consumption. High-value persistent documents:

- architecture boundaries
- dependency rules
- workflow standards
- testing strategy
- deployment assumptions
- naming conventions

The more durable knowledge lives in the repository itself, the less
conversational memory Claude must retain.

---

## 9. Optimize Human Prompting Style

Prefer: "Patch the debounce implementation."  
Over: "Hey Claude, I was wondering if maybe we could rethink how this
debounce logic works..."

Short, high-precision prompts improve reasoning focus, reduce latency, reduce
context accumulation, and improve deterministic behavior.

---

## 10. Recommended High-Efficiency Workflow

```text
1.  Define problem narrowly
2.  Reference exact files/functions
3.  Request hypotheses only
4.  Approve one direction
5.  Request targeted patch
6.  Run validation locally
7.  Paste only failing output
8.  Iterate narrowly
9.  Compact aggressively at ~60% context
10. Clear context between domains
```

This workflow substantially extends session longevity while improving
reasoning consistency and implementation accuracy.
