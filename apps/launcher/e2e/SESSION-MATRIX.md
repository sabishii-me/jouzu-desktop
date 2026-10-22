# Session switching task and acceptance matrix

This is the canonical task and acceptance document for session opening, switching,
history loading, and the session-scoped TextGuard bar.

## Product invariants

1. A session row click changes the visible session on the next frame. It does not attach
   the runtime.
2. The visible transcript comes from the newest local messages first. It is not replaced
   by an empty intermediate projection.
3. The runtime attaches only when an action needs it: send, Review, or an explicit
   extension command.
4. One user action produces at most one runtime attachment.
5. A session that never had a TextGuard event never shows the TextGuard bar.
6. A TextGuard review shown as actionable must come from a real inspect payload that was
   persisted by the desktop app. Transcript text is never treated as review data.
7. Opening a session positions the transcript at its newest turn.

## State model

- `selectedSession`: what the user is viewing. Owned by `ChatWorkspace`.
- `attachedSession`: what the runtime currently owns. Owned by `ChatConnection`.
- `TextGuard review store`: desktop-owned JSON, keyed by session id.

No other component may own or reset those states.

## Test matrix

### A. Session shapes

| Case | Fixture | Expected |
| --- | --- | --- |
| empty | no messages | empty state, no article |
| short | 2 messages | newest answer visible |
| long | 60 turns | last 30 rendered, scroll at bottom |
| very long | 400 turns | bounded read, no blank, scroll at bottom |
| tool heavy | many tool calls | tools render, no duplicate transcript |
| image turn | image block | image renders, scroll stays at bottom |
| failed turn | errorMessage | error visible, transcript intact |
| recovered | recovered suffix | opens like its source session |
| TextGuard withheld | persisted review | yellow bar with real item, no fake Review |
| TextGuard handled | persisted review with zero items | green bar, modes available |
| clean | no TextGuard event | no bar |

### B. Switching sequences

| Case | Action | Expected |
| --- | --- | --- |
| single | A | zero `switch_session` calls while opening |
| pair | A then B | zero calls while opening; B transcript visible |
| rapid | A, B, C, D within 300ms | final D visible, no blank intermediate |
| repeat | A/B/A/B × 10 | no duplicate loads, final B visible |
| same row | A twice | one visual selection, no second load |
| during startup | click A before first connect | no blank, one final load |
| refresh | open A, refresh, click A | no double load, no blank |
| send | open A, send | exactly one `switch_session`, then one prompt |
| send during attach | send before attach completes | one switch, prompt after it |

### C. TextGuard

| Case | Expected |
| --- | --- |
| live inspect with items | persist, yellow bar, item content |
| live inspect with zero items | green bar, no item |
| persisted review, runtime restarted | yellow bar from disk, no runtime attach |
| Review on persisted review | one attach; if runtime lacks review, keep saved content and mark stale |
| approve | item removed from store, no stale Review |
| dismiss | item removed from store |
| mode change | On/Strict/Off inside Review panel |
| clean session | no bar |

### D. Performance metrics

Measured in Playwright with `performance.now()` around the click and the first rendered
message. Driver overhead is excluded from the in-page metric.

| Metric | Target |
| --- | --- |
| click to selected title/row | <= 16ms |
| click to first cached message | <= 50ms |
| click to first disk message | <= 250ms |
| runtime attach on open | 0 |
| runtime attach on send | 1 |
| blank transcript frames during switch | 0 |
| duplicate switch calls for one intent | 0 |

## New task

Implement the matrix in this order:

1. Add a fixture builder that creates deterministic sessions for every shape.
2. Add `session-matrix.spec.ts` with data-driven shape and sequence tests.
3. Instrument click-to-selection and click-to-first-message with `performance.now()`.
4. Add a TextGuard persistence test that survives a page reload.
5. Keep the old `session-switch.spec.ts` only for the send-time switch path.
6. Record failures as a regression table in this document before fixing them.

## Current known debt

- The runtime still reads full history during attach. Opening a session no longer waits
  for it, but attach latency remains unbounded.
- TextGuard reviews created before desktop persistence existed cannot be recovered.
- Existing e2e fixtures use two tiny sessions; they do not cover long histories, rapid
  switching, refresh, or TextGuard.
