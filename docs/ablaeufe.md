# Abläufe: Skill, Linter, Haken

Stand 2026-11-16. Fünf Bilder zu der Frage, wie der Linter in den Schreibablauf
eingreift — oder auch nicht.

Legende: grün = tut das Richtige · gelb = Prüfung mit Befund · rot = greift am
falschen Ort · blau = Haken oder Werkzeug.

## A · Skill: Anweisung vor dem Schreiben

Heute im Einsatz. Verhindert Verstöße, statt sie zu finden.

```mermaid
flowchart LR
  Q["Deine Frage"] --> S["Skill ste100<br/>10 Regeln, ~300 Token"]
  S --> M["Modell schreibt<br/>in STE"]
  M --> A["Antwort<br/>von Anfang an STE"]
  classDef plain fill:#f1f5f9,stroke:#475569,color:#1e293b
  classDef hook fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef good fill:#dcfce7,stroke:#15803d,color:#14532d
  class Q plain
  class S hook
  class M,A good
```

Kosten: eine Ladung Regeln, keine Nacharbeit. Grenze: das Modell kann Regeln
trotzdem übergehen.

## B · Linter auf Zuruf

Heute im Einsatz als `/ste-lint`. Prüft, was schon geschrieben ist.

```mermaid
flowchart LR
  A["Antwort des Modells<br/>erst geschrieben"] --> C["/ste-lint<br/>auf Zuruf"]
  C --> B["Befunde und Score<br/>Regel, Zeile, Text"]
  B --> D["Du entscheidest<br/>umschreiben oder nicht"]
  classDef plain fill:#f1f5f9,stroke:#475569,color:#1e293b
  classDef hook fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef warn fill:#fef3c7,stroke:#b45309,color:#78350f
  class A,D plain
  class C hook
  class B warn
```

Kosten: null bis zum Aufruf. Grenze: die Nacharbeit bleibt bei dir.

## C · Haken an `turn_end` — verworfen

Feuert bei jedem Modellschritt, also auch mitten in einer Werkzeugkette und in
Subagenten-Sitzungen.

```mermaid
flowchart LR
  subgraph F1["Fall 1"]
    A1["Modellschritt mit<br/>zwei toolCalls"] --> H1["turn_end"] --> X1["greift auf<br/>Zwischentext"]
  end
  subgraph F2["Fall 2"]
    A2["Modellschritt im<br/>Subagenten"] --> H2["turn_end"] --> X2["greift auf Bericht<br/>an den Aufrufer"]
  end
  subgraph F3["Fall 3"]
    A3["Modellschritt mit<br/>nur Text an dich"] --> H3["turn_end"] --> X3["greift richtig"]
  end
  classDef plain fill:#f1f5f9,stroke:#475569,color:#1e293b
  classDef hook fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef bad fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  classDef good fill:#dcfce7,stroke:#15803d,color:#14532d
  class A1,A2,A3 plain
  class H1,H2,H3 hook
  class X1,X2 bad
  class X3 good
```

Zwei von drei Fällen sind falsch. Deshalb nicht `turn_end`.

## D · Haken an `agent_before_settle` mit acht Prüfungen

Feuert erst, wenn das Modell aufhört, und lässt nur durch, was wirklich eine
Antwort an dich ist.

```mermaid
flowchart LR
  S["Modell setzt zum<br/>Antworten an"] --> G["acht Prüfungen,<br/>alle müssen passen:<br/>1 eingeschaltet<br/>2 outcome = completed<br/>3 canContinue nicht false<br/>4 Modus = tui<br/>5 Lauf von Nutzereingabe<br/>6 kein toolCall<br/>7 einmal pro Nachricht<br/>8 überwiegend Fließtext"]
  G -->|alle grün| R["eine Reparaturrunde<br/>repairInstructions()"]
  G -.->|eine rot| P["durchlassen<br/>kein Eingriff"]
  classDef plain fill:#f1f5f9,stroke:#475569,color:#1e293b
  classDef hook fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef good fill:#dcfce7,stroke:#15803d,color:#14532d
  class S hook
  class G plain
  class R good
  class P plain
```

Der Haken sitzt am Ende des Laufs. Er sieht nur fertige Antworten an dich.

## E · Wo die Haken in einem Lauf sitzen

Dieselbe Antwort, drei Modellschritte. Der Unterschied ist der Zeitpunkt.

```mermaid
sequenceDiagram
  actor Du
  participant Modell
  participant Werkzeug
  Du->>Modell: Frage
  Modell->>Werkzeug: toolCall
  Werkzeug-->>Modell: Ergebnis
  Note over Modell: turn_end — greift hier fälschlich
  Modell->>Werkzeug: toolCall
  Werkzeug-->>Modell: Ergebnis
  Note over Modell: turn_end — greift hier fälschlich
  Modell->>Du: Antwort, nur Text
  Note over Modell,Du: turn_end und agent_before_settle — hier richtig
```

`turn_end` kommt dreimal, die Antwort an dich ist nur der letzte Schritt.

## Quelle der Aussagen

pi-Typen `TurnEndEvent` (mit `turnIndex`, `message`, `toolResults`),
`AgentBeforeSettleEvent` (mit `outcome`) und `AgentActivityOutcome`. Die
Umsetzung steht in [`../extensions/guard.js`](../extensions/guard.js), die
Begründung in [`entscheidungen.md`](entscheidungen.md).
