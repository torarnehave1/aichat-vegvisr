# GrokChatPanel Migration – Slice 9 (Image Generation Persistence)

## Scope
Mirror how the Vue panel persists generated images in chat history so the image renders after reload.

## Vue Behavior (source of truth)
- Image generation uses `https://openai.vegvisr.org/images`.
- The response returns either `b64_json` (base64) or a direct `url`.
- The message is stored with `imageData` in `/chat-history/messages`.
- `imageData` fields include:
  - `base64Data` (from `b64_json`)
  - `previewImageUrl` (from `url`)
  - `mimeType`, `model`, `prompt`, `size`, `quality`
- On render, the UI shows the image using base64 if present, otherwise the URL.

## React Migration Implementation
- Uses the same image endpoint for generation.
- Builds the same `imageData` object and attaches it to the assistant message.
- Persists messages to `https://api.vegvisr.org/chat-history/messages` with `imageData` included.
- Renders images using the same base64-or-URL fallback.

## Files
- `src/components/GrokChatPanel.tsx`

## Next Slice Candidates
1. Streaming responses (true streaming transport)
2. Tool call wiring (Proff/Sources/Templates)
3. Persist and restore non-text attachments (audio transcript metadata)
