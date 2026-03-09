# aichat-vegvisr — Claude Code Instructions

## Proactive Analysis — MANDATORY

Before writing or modifying ANY code, complete this checklist:

### 1. Impact Analysis (BEFORE coding)
- **List every user interaction** affected by your change (clicks, inputs, navigation, API calls, dialogs)
- **Trace each interaction end-to-end**: what functions fire, what browser APIs are used, what network requests happen, what permissions are needed
- **Ask yourself**: "If I were a user clicking every button in this app, what would break?"
- **For iframes/sandboxes/workers**: list ALL browser APIs the hosted content uses (fetch, prompt, alert, localStorage, postMessage, window.open, etc.) and ensure ALL are permitted

### 2. Anticipate Failures (BEFORE coding)
- **For every new feature**: list 3-5 things that could go wrong
- **For every environment boundary** (iframe, worker, cross-origin): list every restriction and verify your code handles them all
- **For React state/closures**: verify that async callbacks, event handlers, and effects will see current values — use refs when needed

### 3. Be PROACTIVE — Think Beyond the Immediate Task
PROACTIVE means: when you implement something, ask "where else does this principle apply?" and handle ALL of those places NOW — not one at a time across multiple sessions.

**Real example of FAILING to be proactive:**
Adding "mandatory console logging" only for NEW HTML creation. A proactive approach would also cover:
- When PATCHING existing HTML → add logging around the fix
- When READING existing HTML → notice missing logging and upgrade it
- When the agent debugs errors → add logging so the same class of error is never vague again
- Apply the principle everywhere it's relevant, not just the narrow place you were asked about

**What proactive looks like in practice:**
- When adding an iframe → list ALL browser APIs the content will use and add ALL sandbox permissions upfront (scripts, forms, same-origin, modals, popups) — not one at a time across 5 deploys
- When adding a feature → ask "what else in the system is affected?" and handle it in the same change
- When fixing a bug → ask "can this same bug exist anywhere else?" and check
- When finishing code → commit, push, deploy without being asked — close the loop
- Each deploy-test-fix cycle costs the user real time and money — your job is to minimize those cycles

### 4. Think Like the User, Not the Developer
- The user will test the FULL app, not just your new feature
- Existing functionality must keep working after your change
- Mentally run through the app as a user before committing

### 5. Debugging
- NEVER assume deployment or cache issues — trace actual runtime values first
- When the user reports a bug twice, the problem is real — investigate deeper
- Read the actual code at the point of failure, don't guess from memory

## Deployment
- This is a Cloudflare Pages app — deploys via git push, NOT wrangler
- Workers in other repos need `wrangler deploy` separately
- ALL workers are in the SAME Cloudflare account — never question service bindings
