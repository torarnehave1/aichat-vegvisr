import { useMemo, useRef, useState } from 'react';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

const extractFirstUrl = (text: string) => {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
};

const providerOptions = [
  { value: 'grok', label: 'Grok' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'perplexity', label: 'Perplexity' }
];

const openaiModelOptions = [
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'gpt-5.1', label: 'GPT-5.1' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4', label: 'GPT-4' }
];

const claudeModelOptions = [
  { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }
];

const providerLabel = (value: string) =>
  providerOptions.find((option) => option.value === value)?.label ?? 'AI';

const CHAT_ENDPOINTS: Record<string, string> = {
  grok: 'https://grok.vegvisr.org/chat',
  openai: 'https://openai.vegvisr.org/chat',
  claude: 'https://anthropic.vegvisr.org/chat',
  gemini: 'https://gemini.vegvisr.org/chat',
  perplexity: 'https://perplexity.vegvisr.org/chat'
};

const DEFAULT_USER_ID = 'ca3d9d93-3b02-4e49-a4ee-43552ec4ca2b';

const GrokChatPanel = () => {
  const [provider, setProvider] = useState('grok');
  const [openaiModel, setOpenaiModel] = useState('gpt-5.2');
  const [claudeModel, setClaudeModel] = useState('claude-opus-4-5-20251101');
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [useGraphContext, setUseGraphContext] = useState(true);
  const [useSelectionContext, setUseSelectionContext] = useState(false);
  const [useProffTools, setUseProffTools] = useState(false);
  const [useSourcesTools, setUseSourcesTools] = useState(false);
  const [useTemplateTools, setUseTemplateTools] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [selectedAudio, setSelectedAudio] = useState<File | null>(null);
  const streamTimer = useRef<number | null>(null);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed
    };

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: ''
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput('');
    await sendToProvider(trimmed, assistantMessage.id);
  };

  const sendToProvider = async (prompt: string, assistantId: string) => {
    const endpoint = CHAT_ENDPOINTS[provider] || CHAT_ENDPOINTS.grok;
    const payload = {
      userId: userId.trim() || DEFAULT_USER_ID,
      model: provider === 'openai' ? openaiModel : provider === 'claude' ? claudeModel : undefined,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Respond in English unless the user explicitly asks for another language.' },
        ...messages.map((msg) => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: prompt }
      ],
      context: {
        useGraphContext,
        useSelectionContext
      },
      tools: {
        useProffTools,
        useSourcesTools,
        useTemplateTools
      },
      attachments: {
        imageName: selectedImage?.name || null,
        audioName: selectedAudio?.name || null
      },
      stream: false
    };

    try {
      setIsStreaming(true);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API error ${response.status}`);
      }

      const data = await response.json();
      const content =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        data?.message ||
        JSON.stringify(data);

      setMessages((prev) =>
        prev.map((msg) => (msg.id === assistantId ? { ...msg, content } : msg))
      );
    } catch (error) {
      const fallback = buildStubResponse(prompt);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content: `${fallback}\n\n[API call failed: ${
                  error instanceof Error ? error.message : 'unknown error'
                }]`
              }
            : msg
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const buildStubResponse = (prompt: string) => {
    const contextFlags = [
      useGraphContext ? 'graph context' : null,
      useSelectionContext ? 'selection context' : null,
      useProffTools ? 'proff tools' : null,
      useSourcesTools ? 'sources tools' : null,
      useTemplateTools ? 'template tools' : null
    ].filter(Boolean);

    const contextLine = contextFlags.length
      ? `Active tools: ${contextFlags.join(', ')}.`
      : 'No tools active.';

    const attachmentLine =
      selectedImage || selectedAudio
        ? `Attachments: ${selectedImage ? selectedImage.name : ''} ${selectedAudio ? selectedAudio.name : ''}`.trim()
        : 'No attachments.';

    return `I received: "${prompt}"\n${contextLine}\n${attachmentLine}\nI will respond as ${providerLabel(
      provider
    )} once the API is connected.`;
  };

  const startStreaming = (content: string, messageId: string) => {
    if (streamTimer.current) {
      window.clearInterval(streamTimer.current);
    }
    setIsStreaming(true);
    setStreamingContent('');

    let index = 0;
    streamTimer.current = window.setInterval(() => {
      index += 2;
      const nextChunk = content.slice(0, index);
      setStreamingContent(nextChunk);

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, content: nextChunk } : msg
        )
      );

      if (index >= content.length) {
        if (streamTimer.current) {
          window.clearInterval(streamTimer.current);
        }
        streamTimer.current = null;
        setIsStreaming(false);
      }
    }, 40);
  };

  const activeModelOptions = useMemo(() => {
    if (provider === 'openai') {
      return openaiModelOptions;
    }
    if (provider === 'claude') {
      return claudeModelOptions;
    }
    return [];
  }, [provider]);

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 shadow-2xl shadow-black/40">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-indigo-500/80 via-slate-900/40 to-purple-500/80 px-6 py-4 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-lg">
            ✦
          </div>
          <div>
            <h3 className="text-lg font-semibold">
              {providerLabel(provider)} Assistant
            </h3>
            <p className="text-xs text-white/70">
              Migration slice 1: layout + provider selector
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="user@email"
            className="h-9 w-48 rounded-xl border border-white/30 bg-white/10 px-3 text-xs text-white placeholder:text-white/40"
          />
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="h-9 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-semibold text-white"
          >
            {providerOptions.map((option) => (
              <option key={option.value} value={option.value} className="text-slate-900">
                {option.label}
              </option>
            ))}
          </select>

          {activeModelOptions.length > 0 && (
            <select
              value={provider === 'openai' ? openaiModel : claudeModel}
              onChange={(event) =>
                provider === 'openai'
                  ? setOpenaiModel(event.target.value)
                  : setClaudeModel(event.target.value)
              }
              className="h-9 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-semibold text-white"
            >
              {activeModelOptions.map((option) => (
                <option key={option.value} value={option.value} className="text-slate-900">
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      <div className="flex min-h-[360px] flex-col gap-6 px-6 py-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/70">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useGraphContext}
                onChange={(event) => setUseGraphContext(event.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/10"
              />
              Use graph context
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useSelectionContext}
                onChange={(event) => setUseSelectionContext(event.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/10"
              />
              Use selection context
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useProffTools}
                onChange={(event) => setUseProffTools(event.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/10"
              />
              Proff lookup
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useSourcesTools}
                onChange={(event) => setUseSourcesTools(event.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/10"
              />
              Sources tools
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useTemplateTools}
                onChange={(event) => setUseTemplateTools(event.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/10"
              />
              Template tools
            </label>
          </div>
          <p className="mt-3 text-white/50">
            These toggles are placeholders for context/tool wiring in the next slice.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
          <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setSelectedImage(file);
              }}
              className="text-xs"
            />
            <span>{selectedImage ? selectedImage.name : 'Attach image'}</span>
          </label>
          <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
            <input
              type="file"
              accept="audio/*"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setSelectedAudio(file);
              }}
              className="text-xs"
            />
            <span>{selectedAudio ? selectedAudio.name : 'Attach audio'}</span>
          </label>
          {(selectedImage || selectedAudio) && (
            <button
              type="button"
              onClick={() => {
                setSelectedImage(null);
                setSelectedAudio(null);
              }}
              className="rounded-full border border-white/20 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
            >
              Clear attachments
            </button>
          )}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-sm text-white/70">
              Start a conversation. Messages will render here.
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-2xl px-4 py-3 text-sm shadow-lg shadow-black/20 ${
                  message.role === 'user'
                    ? 'ml-auto w-fit bg-sky-500/80 text-white'
                    : 'bg-white/10 text-white/80'
                }`}
              >
                {message.content}
                {message.role === 'assistant' && extractFirstUrl(message.content) && (
                  <div className="mt-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70">
                    <div className="font-semibold text-white/80">Link preview</div>
                    <a
                      href={extractFirstUrl(message.content) ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate text-sky-300 hover:text-sky-200"
                    >
                      {extractFirstUrl(message.content)}
                    </a>
                  </div>
                )}
              </div>
            ))
          )}
          {isStreaming && !streamingContent && (
            <div className="w-fit rounded-2xl bg-white/10 px-4 py-3 text-xs text-white/60">
              Thinking…
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <label className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
            Message
          </label>
          <div className="mt-3 flex flex-col gap-3 md:flex-row">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  sendMessage();
                }
              }}
              placeholder="Type a message..."
              className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={isStreaming}
              className="rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/30"
            >
              {isStreaming ? 'Streaming...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default GrokChatPanel;
