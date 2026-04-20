# Archive Beta MVP Scope

## Beta Objective
Launch a site-first beta by Sunday that demonstrates a useful AI fashion broker workflow.

## In Scope
### 1. Responsive chat-style web app
- mobile-first layout
- desktop-compatible layout
- landing page + live interaction area

### 1b. Visual design — premium black glass aesthetic
- all-black / near-black color palette — no bright backgrounds
- glassmorphism throughout: frosted glass cards, translucent borders, backdrop blur
- subtle light effects: soft glows, luminous accents, gradient borders
- refined micro-animations: smooth fades, hover lifts, shimmer loading states
- high-end typography: tight tracking, generous whitespace, deliberate hierarchy
- the overall feel should be luxury tech — think Apple product pages, not a SaaS dashboard
- no flat/generic UI — every surface should feel layered and dimensional

### 2. Input modes
- outfit photo upload
- free-text style / aesthetic prompt
- optional budget field
- optional occasion field

### 3. AI style audit
Return a structured response with:
- quick verdict
- what works
- what does not
- recommended adjustments
- missing pieces

### 4. Shopping recommendations — real product search
- the AI must search for and return **real, recent, shoppable products** based on the detected style
- products should be actual items currently available from real retailers
- no hardcoded catalog — recommendations must be dynamic and style-aware
- each product needs: title, brand, price, image, and a working link to buy
- results should feel curated and relevant to the specific audit, not generic
- this is a **core MVP feature** alongside the UI rework

### 5. Session continuity
- keep current conversation in-session
- basic history for current browser session only

### 6. Basic instrumentation
- track prompt submitted
- track response generated
- track product link clicked

## Nice to Have
- SMS follow-up handoff
- shareable result card
- save last 3 sessions locally
- multiple recommendation modes like budget / elevated / trend-forward

## Explicitly Out of Scope
### Fit DNA scope exclusions
- 3D body model
- precise body measurement extraction
- garment spec matching engine
- size recommendation guarantee
- return-rate claims

### Resale agent scope exclusions
- live price ingestion
- resale timing predictions
- arbitrage alerts
- marketplace inventory intelligence

### Product scope exclusions
- user accounts
- payments
- subscriptions
- wardrobe closet management
- native app
- admin dashboard
- complex memory across sessions

## MVP Promise
The beta only promises:

**upload or describe a look -> get a useful audit -> get shoppable next-step recommendations**

## Required Screens
1. Home / Landing
2. Chat / Audit screen
3. Result state inside chat
4. Error / Empty states

## Required Components
- upload box
- chat input
- response card sections
- product link cards
- loading state
- retry state

## Done Means
- user can complete end-to-end flow in under 2 minutes
- at least one sample photo flow works reliably
- at least one text-only flow works reliably
- product links render consistently
- mobile view is clean enough for social demo traffic
