# GrokChatPanel Migration – Slice 1 (Layout + Provider Selector)

## Scope
This slice recreates the panel shell and provider/model selectors.
No chat logic, streaming, or tool calls yet.

## What is included
- Panel layout and header
- Provider dropdown
- Model dropdown for OpenAI + Claude
- Placeholder body

## Files
- `src/components/GrokChatPanel.tsx`
- `src/App.tsx`

## Next slice candidates
1. Message list + composer
2. Streaming response state
3. Context toggles (graph/selection)
