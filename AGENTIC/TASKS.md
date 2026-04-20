# Archive Beta Tasks

## Phase 0 — Spec Lock
- [ ] Finalize beta messaging
- [ ] Finalize output schema
- [ ] Finalize product categories for recommendations
- [ ] Finalize curated product data source

## Phase 1 — Project Setup
- [ ] Create Next.js app with TypeScript and Tailwind
- [ ] Set up deployment target
- [ ] Add environment variable handling
- [ ] Add base layout and typography

## Phase 2 — Core UI
- [ ] Build landing page hero and CTA
- [ ] Build chat-style interaction shell
- [ ] Build photo upload component
- [ ] Build text input / prompt composer
- [ ] Build loading and error states

## Phase 3 — AI Audit Flow
- [ ] Define structured response schema
- [ ] Build server route for audit generation
- [ ] Build prompt builder for photo flow
- [ ] Build prompt builder for text-only flow
- [ ] Validate and sanitize model output

## Phase 4 — Recommendation Layer
- [ ] Create curated product dataset
- [ ] Map missing pieces to product categories
- [ ] Render product cards with outbound links
- [ ] Add budget-aware filtering if possible

## Phase 5 — Session Experience
- [ ] Preserve current thread in browser session
- [ ] Allow follow-up prompts in same session
- [ ] Add reset / start over action

## Phase 6 — Analytics
- [ ] Track submission event
- [ ] Track successful response event
- [ ] Track product click event

## Phase 7 — QA
- [ ] Test mobile Safari / Chrome
- [ ] Test desktop Chrome
- [ ] Test image upload success / failure paths
- [ ] Test empty prompt handling
- [ ] Test malformed model output fallback

## Stretch Tasks
- [ ] SMS handoff flow
- [ ] Share result card
- [ ] Recommendation modes: budget / elevated / trend-forward

## Suggested Build Order
1. scaffold app
2. build UI shell
3. hardcode fake response card
4. wire real model response
5. wire curated product cards
6. improve structure and polish
7. add analytics
8. test everything
