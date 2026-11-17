# Flows

How the linter reaches a text, and where the repair hook sits. State as built,
version 0.1.8.

Legend: green = does the right thing · amber = check with a finding · blue = hook
or command.

## A · Skill: rules before writing

Writes in simplified technical language from the start.

```mermaid
flowchart LR
  Q["Your question"] --> S["Skill ste100<br/>10 rules, ~300 tokens"]
  S --> M["Model writes<br/>in STE"]
  M --> A["Answer<br/>STE from the start"]
  classDef plain fill:#f1f5f9,stroke:#475569,color:#1e293b
  classDef hook fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef good fill:#dcfce7,stroke:#15803d,color:#14532d
  class Q plain
  class S hook
  class M,A good
```

Cost: one load of the rules, no rework. Limit: the model can still break a rule.

## B · Linter on request

The `/ste-lint` command. Checks what has already been written.

```mermaid
flowchart LR
  A["Model answer<br/>already written"] --> C["/ste-lint<br/>on request"]
  C --> B["Findings and score<br/>rule, line, text"]
  B --> D["you decide<br/>rewrite or not"]
  classDef plain fill:#f1f5f9,stroke:#475569,color:#1e293b
  classDef hook fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef warn fill:#fef3c7,stroke:#b45309,color:#78350f
  class A,D plain
  class C hook
  class B warn
```

Cost: nothing until you call it. Limit: the rework is yours.

## C · Repair hook on `agent_before_settle`

Runs once, when the model is about to finish. Seven gates must pass before it
touches the answer.

```mermaid
flowchart LR
  S["Model is about<br/>to answer"] --> G["seven gates,<br/>all must pass:<br/>1 hook is on<br/>2 outcome = completed<br/>3 mode = tui<br/>4 run started by a user<br/>5 no toolCall in the message<br/>6 at most one repair per answer<br/>7 mostly prose, not code"]
  G -->|all green| L["lint the answer"]
  G -.->|one red| P["pass through<br/>no change"]
  L -->|score below threshold| R["one repair round<br/>repairInstructions()"]
  L -.->|score at or above| P
  classDef plain fill:#f1f5f9,stroke:#475569,color:#1e293b
  classDef hook fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef good fill:#dcfce7,stroke:#15803d,color:#14532d
  classDef warn fill:#fef3c7,stroke:#b45309,color:#78350f
  class S hook
  class G plain
  class L warn
  class R good
  class P plain
```

The footer carries the score of every answer to you — `STE(85) Current: 74` — and
keeps a finished round visible as `STE(85) Current: 74 → 94`. That number costs no
model round; it is a lint of a text that already exists.

Threshold default 90, set with `/ste-guard on 85`. Gate 1 starts from
`<agent-dir>/ste-lint.json` (shipped copy: `assets/ste-lint.json`); the command
changes it for the session only. One repair per answer: the
continuation itself is not treated as a user run, so gate 6 is the loop stop.
Every decision is logged with a reason code when `PI_STE_LINT_DEBUG` is set.

The round is visible: notification with score and fix count, a banner in the
transcript, and the footer moving from `Current: 36` to `Current: 36 → …` and
finally `Current: 36 → 94`. Nothing of that reaches the model context.

## D · Where the hook sits in one run

One answer, three model steps. Only the last one is an answer to you.

```mermaid
sequenceDiagram
  actor You
  participant Model
  participant Tools
  You->>Model: question
  Model->>Tools: toolCall
  Tools-->>Model: result
  Model->>Tools: toolCall
  Tools-->>Model: result
  Model->>You: answer, text only
  Note over Model,You: agent_before_settle — gates, then lint
```

Tool steps pass without a check. The hook sees a finished answer or nothing.

## Source of the statements

pi types `AgentBeforeSettleEvent` (with `outcome`) and `AgentActivityOutcome`.
The implementation is in [`../extensions/guard.js`](../extensions/guard.js) and
[`../extensions/settings.js`](../extensions/settings.js), the
reasons in [`decisions.md`](decisions.md).
