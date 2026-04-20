# Archive Beta PRD

## Product
Archive is a site-first AI fashion broker that helps users improve an outfit or build toward a target aesthetic, then converts that advice into shoppable links.

The long-term company vision has two defensible pillars:

1. **Fit DNA** — a body-aware fit layer that maps user measurements and proportions to better item recommendations.
2. **Resale Arbitrage Agent** — a market layer that identifies when fashion items are underpriced to buy or well-timed to sell.

## Beta Goal
Ship a working beta by **Sunday** that proves one thing:

**Users will submit an outfit photo or style intent, receive useful fashion recommendations quickly, and click through to shopping links.**

This beta is not trying to solve perfect fit prediction or true resale arbitrage yet.

## Beta Product Definition
Archive Beta is a mobile-responsive website with a chat-first interface inspired by an agent product experience.

The user can:
- upload an outfit photo or describe an aesthetic
- receive a style audit
- get suggested improvements or missing pieces
- receive direct product links
- optionally continue the thread over SMS later

Desktop should also work well, but mobile web is the primary design target.

## Target Users
Primary early users:
- style-conscious Gen Z shoppers
- fashion students / creators
- resellers
- people who want fast outfit feedback before buying
- users who like agent-style chat experiences instead of normal shopping flows

## Core User Problem
Users struggle with:
- knowing whether an outfit actually works
- knowing what exact item would improve the outfit
- turning style inspiration into a concrete purchase
- confidence around buying the right thing fast

## Beta Value Proposition
Archive Beta gives users a faster path from:
- outfit uncertainty -> specific feedback
- vague aesthetic intent -> concrete items
- style curiosity -> commerce action

## Key User Stories
1. As a user, I want to upload an outfit photo and get useful style feedback.
2. As a user, I want to describe a vibe or aesthetic and get product suggestions.
3. As a user, I want direct shopping links so I can act immediately.
4. As a user, I want the experience to feel conversational, fast, and low-friction.
5. As a user, I want the site to work on my phone without downloading an app.

## Beta UX Flow
### Flow A: Outfit photo
1. User lands on homepage
2. User uploads outfit photo
3. User optionally adds goal context
   - where they're going
   - desired aesthetic
   - budget
4. Archive returns:
   - style audit
   - what works
   - what is off
   - 2–5 improvement directions
   - 3–8 recommended items / missing pieces
5. User clicks product links
6. User can continue the thread or submit another look

### Flow B: Aesthetic intent
1. User lands on homepage
2. User types what they want to look like
3. Archive asks clarifying questions if needed
4. Archive returns:
   - interpreted aesthetic
   - recommended outfit formula
   - suggested items
   - shopping links

## Beta Output Format
For consistency, the agent should respond in a structured format:

- **Overall take**
- **Style audit score**
- **What is working**
- **What to fix**
- **Missing pieces**
- **Shopping picks**
- **Why these picks fit the goal**

## Monetization
### Beta monetization
- affiliate product links
- retailer / marketplace referrals

### Future monetization
- premium personalization
- Pro Reseller tier
- fit-based shopping optimization
- resale timing intelligence

## Success Metrics
### Primary
- submission to response completion rate
- click-through rate on product links
- repeat sessions

### Secondary
- average time to first useful response
- number of product clicks per session
- % of sessions with a second prompt
- SMS opt-in rate if added

## Beta Non-Goals
Do not treat these as beta requirements:
- 3D body reconstruction
- guaranteed fit matching
- true resale timing engine
- marketplace price prediction
- full wardrobe management
- user accounts
- advanced personalization memory
- native mobile apps
- seller tools
- complex back-office analytics

## Risks
- AI style feedback may feel generic
- product recommendations may feel weak if catalog quality is poor
- vision quality may vary depending on image quality
- fit claims can become legally or practically dangerous if overstated

## Positioning for Beta
Archive Beta should be framed as:

**an AI fashion broker that audits outfits and finds the next best pieces to buy**

Not as:
- a guaranteed fit engine
- a resale oracle
- a full wardrobe operating system

## Launch Definition
The beta is ready if:
- the site works on mobile and desktop
- users can upload a photo or type a prompt
- the system returns a consistent style audit
- the system returns working shopping links
- the experience feels fast enough to demo live
