# GrokChatPanel Migration – Slice 5 (Link Preview Placeholder)

## Scope
Adds a lightweight link preview block for assistant messages that contain URLs.

## What is included
- URL detection (first URL in message)
- Inline preview card (no fetch yet)

## Files
- `src/components/GrokChatPanel.tsx`

## Next slice candidates
1. Fetch real link preview data (sources-worker)
2. Attachments (image/audio)
3. Tool wiring to API payload
