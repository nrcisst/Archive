# AGENTS.md

## Project Mission
Build the beta version of Archive: a site-first AI fashion broker that accepts a photo or style prompt, returns a structured style audit, and recommends items to shop next.

## Product Truth
This repo is for the **beta**, not the full long-term company vision.

The long-term ideas of Fit DNA and resale arbitrage exist, but they are **not** core implementation targets for the Sunday launch.

## Primary Goal
A user should be able to:
1. submit a photo or text prompt
2. get a useful style audit
3. click into recommended items

## Allowed Work
Agents may:
- build UI for the beta flow
- implement server routes
- improve prompt structure
- add schema validation
- create mock / curated product datasets
- add analytics events
- improve loading, error, and empty states
- write tests

## Disallowed Work
Agents must not:
- invent full account systems
- add subscriptions or payment flows
- claim exact fit certainty
- build resale prediction systems
- add unrelated dashboards
- rewrite the whole architecture without being asked
- make branding or product strategy changes silently

## Coding Rules
- Use TypeScript.
- Keep components small and readable.
- Prefer clear names over clever code.
- Avoid introducing heavy dependencies unless necessary.
- Reuse existing types and utilities when possible.
- Do not change unrelated files.

## Output Rules
When implementing a task, always report:
- what changed
- which files changed
- any assumptions made
- any unresolved risks

## Task Size Rule
Do not attempt huge multi-step rewrites in one pass.
Break large work into small, verifiable chunks.

## UI Rules
- mobile-first
- desktop-safe
- clean and minimal
- conversational, not cluttered
- prioritize result clarity over flashy visuals

## Data Rules
- no fabricated analytics claims
- no fake “guaranteed fit” language
- no fake resale intelligence claims
- beta recommendations can be heuristic, but that must be reflected in implementation

## Prompting Rules
When modifying the AI output behavior:
- preserve the required response structure
- keep outputs concise and actionable
- avoid generic fashion filler
- aim for concrete suggestions and product categories

## Testing Rules
Any feature that changes logic should include at least one validation path:
- unit test
- schema validation
- manual test checklist

## Escalation Rule
If a requested task conflicts with the beta scope, preserve the existing scope and note the conflict instead of silently expanding the product.

## Progress Tracking Rule
After completing each agent loop, update `AGENTIC/progress.md` with:
- the loop number
- what was done
- files created or modified
- what was validated
- any issues found
- next planned step

This file is the living record of build progress. Always read it at the start of a new session.
