# Navigation and Ask layout repair

Approved by the operator in chat, 2026-10-23. Risk: normal (UI positioning and navigation).

Scope: hamburger selection, brighter dropdown surfaces, higher Mesh tabs/content and empty
Ask input, a distinct floating Ask composer above the conversation after submission.
Out of scope: ingestion, retrieval, billing, database schema, MCP contracts and model output.

Acceptance criteria:
- Given an open hamburger, when a destination is selected by pointer/touch or keyboard,
  then navigation completes and the menu closes; theme selection and sign-out remain usable.
- Given the light theme, when a dropdown opens, then its surface uses the raised paper token.
- Given Mesh or empty Ask, when loaded, then the content begins beneath the header rather
  than around the screen midpoint; Mesh tabs begin within the first 100 CSS pixels.
- Given a long conversation, when the user scrolls over the thread or composer, then the
  conversation scrolls and the composer remains visible above the bottom navigation.
- Given a growing multiline input, when its height changes, then the last reply has enough
  clearance; textarea scrolling takes precedence until its boundary.
- Given an empty input, when rendered, then submission is disabled and makes no request.

Validation: source-level layout contracts and pure scroll helper unit tests; real-component
menu selection tests; headed Playwright release-path assertions using deterministic chat
responses, including two turns and the empty-submit negative probe. No LLM calls or new
server contracts. Existing CI gates remain lint, Svelte naming, check and unit tests.
The agent MCP benchmark does not add a new tool flow: this repairs browser chrome only.

Sequence: reproduce and write regressions, repair the affected UI layer, run focused tests,
component tests and local CI. Keep the existing unrelated working-tree changes intact.
