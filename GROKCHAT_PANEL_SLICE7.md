# GrokChatPanel Migration – Slice 7 (Tool + Attachment wiring stub)

## Scope
Wires the current toggles and attachment state into a stubbed response so we can validate payload assembly before real API calls.

## What is included
- Stub response includes active tools
- Stub response includes selected attachments

## Files
- `src/components/GrokChatPanel.tsx`

## Next slice candidates
1. Real API request payloads (grok/openai/claude)
2. Link preview fetch (sources-worker)
3. Attachment upload endpoints
