# GrokChatPanel Migration – Slice 8 (Real API Calls)

## Scope
Wires the chat submit to real Worker endpoints per provider.

## What is included
- Provider endpoint mapping
- POST request with messages + tool/context flags
- Parses OpenAI-style responses
- Fallback stub on error

## Files
- `src/components/GrokChatPanel.tsx`

## Next slice candidates
1. Real streaming responses
2. Tool call wiring (Proff/Sources/Templates)
3. Attachment upload + media handling
