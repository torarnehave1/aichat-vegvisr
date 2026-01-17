# GrokChatPanel.vue -> React Migration Notes

## Source
- File: `vegvisr-frontend/src/components/GrokChatPanel.vue`
- Type: Vue SFC with `<script setup>` + scoped CSS

## Props (input)
- `graphData` (required object)
- `selectionContext` (optional object, default `null`)
- `parentContext` (optional string: `viewer | canvas`, default `viewer`)

## Emits (output events)
- `insert-fulltext`
- `insert-fulltext-batch`
- `insert-node`
- `insert-network`
- `insert-person-network`
- `import-graph-as-cluster`

## External dependencies
- Vue router: `useRouter`
- Stores:
  - `useUserStore`
  - `useKnowledgeGraphStore`
- Components:
  - `ImageSelector.vue`
- Assets/icons:
  - `grok.svg`, `openai.svg`, `perplexity.svg`, `claude.svg`, `gemini.svg`
  - `graph-context.svg`, `proff.svg`

## Core features (must re-create)
1. Provider + model selectors
2. Message list + streaming responses
3. Graph context toggle + selection context toggle
4. Tool usage toggles (Proff, Sources, Templates)
5. Insert actions (emit events above)
6. Background image selector + persistence (`localStorage: grok-chat-background`)
7. Audio upload + transcription flow
8. Link preview + citation preview

## API endpoints used
### AI chat + tools
- `https://grok.vegvisr.org/chat`
- `https://openai.vegvisr.org/chat`
- `https://anthropic.vegvisr.org/chat`
- `https://gemini.vegvisr.org/chat`
- `https://perplexity.vegvisr.org/chat`
- `https://openai.vegvisr.org/images`

### Tools / data sources
- `https://proff-worker.torarnehave.workers.dev`
- `https://sources-worker.torarnehave.workers.dev`
- `https://knowledge.vegvisr.org/getToolTemplates`
- `https://knowledge.vegvisr.org/getTemplates`

### Graph + history
- `https://knowledge.vegvisr.org/saveGraphWithHistory`
- `https://grok.vegvisr.org/process-transcript`
- `https://api.vegvisr.org/chat-history`
- `https://api.vegvisr.org/save-approved-image`

### Other
- `link-preview` via `sources-worker`:
  - `https://sources-worker.torarnehave.workers.dev/link-preview`

## Suggested React breakdown
- `ChatPanel` (layout + header + collapse state)
- `ProviderSelector` (provider + model)
- `ContextToggles` (graph/selection + tool toggles)
- `ChatMessages` (message list + streaming bubble)
- `ChatComposer` (input + send + attachments)
- `AudioUploader` (transcribe flow)
- `ImageSelector` (ported component)
- `CitationPreview` (link preview hover)

## React state mapping (examples)
- `ref(...)` -> `useState(...)`
- `computed(...)` -> `useMemo(...)`
- `watch(...)` -> `useEffect(...)`
- `nextTick(...)` -> `requestAnimationFrame` or `useLayoutEffect`

## Minimal migration slice (recommended order)
1. Layout + header + provider selector
2. Message list + send input (no tools)
3. Streaming response handling
4. Context toggles (graph + selection)
5. Link preview + citation
6. Audio upload + transcription
7. Tools: Proff/Sources/Template tools
8. Graph insert events + batch operations

## Notes on CSS conversion
The Vue component uses scoped CSS. Recreate styles with Tailwind:
- Header gradient -> Tailwind `bg-gradient-to-r`
- Panel layout -> flex + `min-h` + `overflow-hidden`
- Toggles + pills -> `rounded-full`, `border`, `bg-opacity`

## Next steps
1. Decide which slice to migrate first.
2. Create React components per breakdown.
3. Wire endpoints behind a single API client.
