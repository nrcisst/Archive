# First 10 Agent Prompts

## 1. Scaffold the app
Create a Next.js TypeScript Tailwind app for Archive Beta. Keep it minimal and clean. This is a mobile-first chat-style site, not a dashboard.

## 2. Build the main layout
Create a landing page and a main interaction shell for Archive Beta. Include a hero, short explanation, upload area, prompt input, and a result panel placeholder.

## 3. Build upload + input components
Implement a photo upload component and a text prompt composer. Keep the UI simple and mobile-friendly. Do not wire backend logic yet.

## 4. Add a fake response state
Create a hardcoded example response card using this structure: overall take, score, what works, what to fix, missing pieces, shopping picks.

## 5. Define the response schema
Create a TypeScript schema / type for the style audit response. Add validation so malformed responses can be caught cleanly.

## 6. Add the server route
Create a server route that accepts text input and optional image metadata, then returns a mocked structured style audit object matching the schema.

## 7. Wire the UI to the server route
Connect the frontend input flow to the server route. Show loading, success, and error states. Do not add real model calls yet.

## 8. Add product cards
Create reusable product recommendation cards with title, image, price, retailer, and outbound link. Use mock data first.

## 9. Add curated recommendation logic
Create a simple recommendation mapping layer that maps missing pieces or categories in the audit response to products from a curated dataset.

## 10. Replace mock audit with real model call
Replace the mocked audit generator with a real model call. Preserve the structured response shape and keep the fallback behavior safe if the output is malformed.
