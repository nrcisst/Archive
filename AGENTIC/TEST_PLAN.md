# Archive Beta Test Plan

## Goal
Verify that the beta reliably completes the core fashion broker flow.

## Core Flow to Validate
A user can submit a photo or text prompt, receive a structured style audit, and click a product recommendation.

## Manual Test Cases
### 1. Text-only prompt
Input:
- “I want a clean black streetwear fit for dinner, budget under $150.”

Expected:
- response returns quickly
- output follows required structure
- product cards appear
- product links are clickable

### 2. Outfit photo upload
Input:
- clear outfit image with visible top, bottoms, shoes

Expected:
- upload succeeds
- audit references visible styling issues or strengths
- missing pieces are sensible
- no broken UI state

### 3. Photo + context
Input:
- outfit photo
- occasion: date night
- budget: $200

Expected:
- output reflects context
- recommendations shift toward the stated occasion and budget

### 4. Empty input
Input:
- submit with no photo and no text

Expected:
- clean validation error
- no server crash

### 5. Bad image
Input:
- unsupported or corrupted image

Expected:
- clear failure message
- retry path available

### 6. Long prompt
Input:
- very long aesthetic description

Expected:
- system still responds
- output remains structured

### 7. Broken model output
Simulate:
- malformed or incomplete model response

Expected:
- safe fallback message
- no raw JSON dumped into UI

## Quality Bar
The beta passes if:
- the core flow works on mobile and desktop
- responses are coherent enough for a live demo
- product cards consistently render
- no major blocking bugs appear in a 10-run test sweep

## Metrics to Inspect
- number of successful submissions
- number of failed submissions
- number of product clicks
- response latency

## Demo Readiness Checklist
- [ ] Landing page looks presentable
- [ ] Mobile layout is clean
- [ ] Text flow works
- [ ] Image flow works
- [ ] Product links work
- [ ] Loading state looks intentional
- [ ] Error state is not embarrassing
- [ ] One good demo prompt is prepared
- [ ] One good demo image is prepared
