import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../lib/LanguageContext';
import { useTranslation } from '../lib/useTranslation';
import { apiTokenHeaders, readApiToken } from '../lib/auth';

// Live speech translation: captures audio (a browser tab or the microphone) in short
// segments, transcribes each segment with Whisper, translates it with Claude and
// keeps both texts in a knowledge graph node that is updated after every segment.

const AUDIO_ENDPOINT = 'https://openai.vegvisr.org/audio';
const TRANSLATE_ENDPOINT = 'https://anthropic.vegvisr.org/chat';
const TRANSLATE_MODEL = 'claude-sonnet-4-5-20250929';
const KNOWLEDGE_BASE = 'https://knowledge.vegvisr.org';
const GRAPH_VIEWER_URL = 'https://www.vegvisr.org/gnew-viewer?graphId=';
const LOCAL_BACKUP_KEY = 'live-translate-last-session';

const SOURCE_LANGUAGE = 'tr';
const SOURCE_LABEL = 'Tyrkisk';
const TARGET_LABEL = 'Norsk';
const SEGMENT_MS = 15000;
const MIN_SEGMENT_BYTES = 2000;

// Whisper tends to "hear" these phrases in silence; drop short segments that match.
const HALLUCINATION_PATTERNS = [
  /altyaz[ıi]\s*m\.?\s*k\.?/i,
  /izledi[gğ]iniz i[cç]in te[sş]ekk[uü]r/i,
  /abone olmay[ıi] unutmay[ıi]n/i,
  /^\s*(m\.?\s*k\.?|\.+)\s*$/i
];

type AudioSource = 'tab' | 'mic';

type Segment = {
  id: string;
  time: string;
  source: string;
  target: string;
  status: 'transcribing' | 'translating' | 'done' | 'error';
  error?: string;
};

type GraphState = {
  id: string;
  nodeId: string;
  version: number;
};

type Props = {
  userId?: string;
  email?: string;
};

const pickMimeType = () => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

const extensionForMime = (mime: string) => {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  return 'webm';
};

const isHallucination = (text: string) =>
  text.length < 80 && HALLUCINATION_PATTERNS.some((pattern) => pattern.test(text));

const buildMarkdown = (title: string, segments: Segment[]) => {
  const body = segments
    .filter((segment) => segment.status === 'done')
    .map(
      (segment) =>
        `**[${segment.time}]**\n\n🇹🇷 ${segment.source}\n\n🇳🇴 ${segment.target}`
    )
    .join('\n\n---\n\n');
  return `# ${title}\n\n${body}`;
};

const parseJson = async (response: Response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

function LiveTranslatePanel({ userId, email }: Props) {
  const { language } = useLanguage();
  const t = useTranslation(language);

  const [source, setSource] = useState<AudioSource>('tab');
  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [graphId, setGraphId] = useState<string | null>(null);
  const [graphStatus, setGraphStatus] = useState('');

  const runningRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const segmentsRef = useRef<Segment[]>([]);
  const graphRef = useRef<GraphState | null>(null);
  const titleRef = useRef('');
  const lastTranslationRef = useRef('');
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const updateSegments = (updater: (previous: Segment[]) => Segment[]) => {
    const next = updater(segmentsRef.current);
    segmentsRef.current = next;
    setSegments(next);
    try {
      localStorage.setItem(
        LOCAL_BACKUP_KEY,
        JSON.stringify({ title: titleRef.current, graphId: graphRef.current?.id || null, segments: next })
      );
    } catch {
      // Local backup is best effort only
    }
  };

  const patchSegment = (id: string, fields: Partial<Segment>) =>
    updateSegments((previous) =>
      previous.map((segment) => (segment.id === id ? { ...segment, ...fields } : segment))
    );

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [segments.length]);

  useEffect(
    () => () => {
      runningRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    []
  );

  const transcribe = async (blob: Blob, mime: string) => {
    const formData = new FormData();
    formData.append('file', blob, `live-segment.${extensionForMime(mime)}`);
    formData.append('model', 'whisper-1');
    formData.append('userId', userId || '');
    formData.append('language', SOURCE_LANGUAGE);
    const response = await fetch(AUDIO_ENDPOINT, {
      method: 'POST',
      headers: apiTokenHeaders(),
      body: formData
    });
    const data = await parseJson(response);
    if (!response.ok) {
      const detail = data?.error || data?.message || `status ${response.status}`;
      throw new Error(`Whisper: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    }
    return String(data?.text || '').trim();
  };

  const translate = async (text: string) => {
    const context = lastTranslationRef.current
      ? `\n\nFor context only (do not translate again), the previous segment was translated as:\n"${lastTranslationRef.current}"`
      : '';
    const response = await fetch(TRANSLATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...apiTokenHeaders() },
      body: JSON.stringify({
        userId,
        model: TRANSLATE_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You translate live speech transcripts from Turkish to Norwegian (bokmål). ' +
              'Translate directly and faithfully, keeping the speaker\'s sentence structure, repetitions and wording as close to the original as Norwegian allows. ' +
              'Do not summarize, do not explain, do not add comments or notes. ' +
              'The transcript is a fragment of ongoing speech and may start or end mid-sentence; translate it as it is. ' +
              'Output only the Norwegian translation.' +
              context
          },
          { role: 'user', content: text }
        ],
        stream: false
      })
    });
    const data = await parseJson(response);
    if (!response.ok) {
      const detail = data?.error || data?.message || `status ${response.status}`;
      throw new Error(`Translation: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    }
    const content =
      data?.choices?.[0]?.message?.content ||
      data?.content?.[0]?.text ||
      data?.choices?.[0]?.text ||
      data?.message;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Translation: empty response');
    }
    return content.trim();
  };

  const saveToGraph = async (allowRetry = true): Promise<void> => {
    const token = readApiToken();
    if (!token) {
      setGraphStatus(t('live.saveNoToken'));
      return;
    }
    const markdown = buildMarkdown(titleRef.current, segmentsRef.current);
    const headers = { 'Content-Type': 'application/json', 'X-API-Token': token };
    setGraphStatus(t('live.saving'));

    if (!graphRef.current) {
      const id = crypto.randomUUID();
      const nodeId = crypto.randomUUID();
      const now = new Date().toISOString();
      const response = await fetch(`${KNOWLEDGE_BASE}/saveGraphWithHistory`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id,
          graphData: {
            metadata: {
              title: titleRef.current,
              description: `Live-oversettelse ${SOURCE_LABEL} → ${TARGET_LABEL}`,
              createdBy: email || userId || 'aichat-vegvisr',
              userId: userId || undefined,
              createdAt: now,
              updatedAt: now
            },
            nodes: [
              {
                id: nodeId,
                label: titleRef.current,
                type: 'fulltext',
                info: markdown,
                color: '#f8fafc',
                position: { x: 100, y: 100 },
                visible: true
              }
            ],
            edges: []
          }
        })
      });
      const data = await parseJson(response);
      if (!response.ok) {
        throw new Error(data?.error || `status ${response.status}`);
      }
      graphRef.current = { id, nodeId, version: Number(data?.newVersion) || 1 };
      setGraphId(id);
      setGraphStatus(t('live.saved'));
      return;
    }

    const graph = graphRef.current;
    const response = await fetch(`${KNOWLEDGE_BASE}/patchNode`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        graphId: graph.id,
        nodeId: graph.nodeId,
        fields: { info: markdown },
        expectedVersion: graph.version
      })
    });
    const data = await parseJson(response);
    if (!response.ok) {
      // Someone else (e.g. the graph editor) changed the graph: adopt their version and retry once.
      if (allowRetry && Number.isInteger(data?.currentVersion)) {
        graph.version = data.currentVersion;
        return saveToGraph(false);
      }
      throw new Error(data?.error || `status ${response.status}`);
    }
    graph.version = Number(data?.newVersion) || graph.version + 1;
    setGraphStatus(t('live.saved'));
  };

  const processSegment = async (segmentId: string, blob: Blob, mime: string) => {
    try {
      const text = await transcribe(blob, mime);
      if (!text || isHallucination(text)) {
        updateSegments((previous) => previous.filter((segment) => segment.id !== segmentId));
        return;
      }
      patchSegment(segmentId, { source: text, status: 'translating' });
      const translated = await translate(text);
      lastTranslationRef.current = translated;
      patchSegment(segmentId, { target: translated, status: 'done' });
    } catch (error) {
      console.error('[LiveTranslate] segment failed', error);
      patchSegment(segmentId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    try {
      await saveToGraph();
    } catch (error) {
      console.error('[LiveTranslate] graph save failed', error);
      setGraphStatus(
        `${t('live.saveFailed')}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const enqueueSegment = (blob: Blob, mime: string) => {
    if (blob.size < MIN_SEGMENT_BYTES) return;
    const segment: Segment = {
      id: crypto.randomUUID(),
      time: new Date().toLocaleTimeString('nb-NO'),
      source: '',
      target: '',
      status: 'transcribing'
    };
    updateSegments((previous) => [...previous, segment]);
    // Process strictly in order so the text and graph versions stay consistent.
    queueRef.current = queueRef.current
      .then(() => processSegment(segment.id, blob, mime))
      .catch((error) => console.error('[LiveTranslate] queue error', error));
  };

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const recordSegment = (audioStream: MediaStream, mime: string) => {
    if (!runningRef.current) return;
    if (!audioStream.getAudioTracks().some((track) => track.readyState === 'live')) {
      // The shared tab/microphone went away (e.g. "Stop sharing" in Chrome).
      runningRef.current = false;
      setRunning(false);
      setStatusText(t('live.stopped'));
      releaseStream();
      return;
    }
    const recorder = mime ? new MediaRecorder(audioStream, { mimeType: mime }) : new MediaRecorder(audioStream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mime || 'audio/webm';
      enqueueSegment(new Blob(chunks, { type }), type);
      if (runningRef.current) {
        recordSegment(audioStream, mime);
      } else {
        releaseStream();
      }
    };
    recorder.onerror = (event) => {
      console.error('[LiveTranslate] recorder error', event);
      setErrorText(t('live.recorderError'));
    };
    recorderRef.current = recorder;
    // A fresh recorder per segment gives every file its own header, which Whisper needs.
    recorder.start();
    timerRef.current = window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, SEGMENT_MS);
  };

  const stop = () => {
    if (!runningRef.current) return;
    runningRef.current = false;
    setRunning(false);
    setStatusText(t('live.stopped'));
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      releaseStream();
    }
  };

  const start = async () => {
    setErrorText('');
    if (!userId) {
      setErrorText(t('live.signIn'));
      return;
    }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      setErrorText(t('live.unsupported'));
      return;
    }

    let stream: MediaStream;
    try {
      if (source === 'tab') {
        // Chrome-specific options: offer tabs, and keep playing the tab audio for the user.
        const options = {
          video: true,
          audio: { suppressLocalAudioPlayback: false },
          preferCurrentTab: false,
          selfBrowserSurface: 'exclude',
          systemAudio: 'include'
        } as DisplayMediaStreamOptions;
        stream = await navigator.mediaDevices.getDisplayMedia(options);
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true }
        });
      }
    } catch (error) {
      console.error('[LiveTranslate] capture failed', error);
      setErrorText(t('live.permissionDenied'));
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      setErrorText(t('live.noAudioTrack'));
      return;
    }

    streamRef.current = stream;
    // Stopping via Chrome's own "Stop sharing" bar ends the tracks; treat it as Stop.
    stream.getTracks().forEach((track) => track.addEventListener('ended', stop));

    if (!titleRef.current || segmentsRef.current.length === 0) {
      titleRef.current = `Live-oversettelse ${new Date().toLocaleString('nb-NO')}`;
    }
    runningRef.current = true;
    setRunning(true);
    setStatusText(t('live.listening'));
    recordSegment(new MediaStream(audioTracks), pickMimeType());
  };

  const clear = () => {
    if (runningRef.current) return;
    updateSegments(() => []);
    graphRef.current = null;
    titleRef.current = '';
    lastTranslationRef.current = '';
    setGraphId(null);
    setGraphStatus('');
    setStatusText('');
  };

  const download = () => {
    const markdown = buildMarkdown(titleRef.current || 'Live-oversettelse', segmentsRef.current);
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `live-oversettelse-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const hasDoneSegments = segments.some((segment) => segment.status === 'done');

  return (
    <section className="mb-10 rounded-3xl border border-white/10 bg-white/5 p-6 text-white shadow-2xl shadow-black/40">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{t('live.title')}</h3>
          <p className="text-xs text-white/70">
            {SOURCE_LABEL} → {TARGET_LABEL} · {t('live.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={source}
            disabled={running}
            onChange={(event) => setSource(event.target.value as AudioSource)}
            className="h-9 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            <option value="tab" className="text-slate-900">
              {t('live.sourceTab')}
            </option>
            <option value="mic" className="text-slate-900">
              {t('live.sourceMic')}
            </option>
          </select>
          {running ? (
            <button
              type="button"
              onClick={stop}
              className="h-9 rounded-xl bg-rose-500 px-4 text-sm font-semibold text-white"
            >
              ■ {t('live.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              className="h-9 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-white"
            >
              ● {t('live.start')}
            </button>
          )}
          <button
            type="button"
            onClick={download}
            disabled={!hasDoneSegments}
            className="h-9 rounded-xl border border-white/30 px-3 text-sm text-white disabled:opacity-40"
          >
            {t('live.download')}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={running || segments.length === 0}
            className="h-9 rounded-xl border border-white/30 px-3 text-sm text-white disabled:opacity-40"
          >
            {t('live.clear')}
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-white/60">
        {source === 'tab' ? t('live.tabHint') : t('live.micHint')}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        {statusText && (
          <span className={running ? 'text-emerald-300' : 'text-white/60'}>
            {running ? '● ' : ''}
            {statusText}
          </span>
        )}
        {graphStatus && <span className="text-white/60">{graphStatus}</span>}
        {graphId && (
          <a
            href={`${GRAPH_VIEWER_URL}${graphId}`}
            target="_blank"
            rel="noreferrer"
            className="text-sky-300 underline"
          >
            {t('live.openGraph')}
          </a>
        )}
      </div>
      {errorText && <p className="mt-2 text-sm text-rose-300">{errorText}</p>}

      <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto rounded-2xl bg-black/30 p-4">
        {segments.length === 0 && <p className="text-sm text-white/50">{t('live.empty')}</p>}
        {segments.map((segment) => (
          <div key={segment.id} className="border-b border-white/10 pb-3 last:border-b-0">
            <div className="text-[11px] text-white/40">{segment.time}</div>
            {segment.status === 'transcribing' && (
              <p className="text-sm italic text-white/50">{t('live.transcribing')}</p>
            )}
            {segment.source && <p className="mt-1 text-sm text-white/60">🇹🇷 {segment.source}</p>}
            {segment.status === 'translating' && (
              <p className="mt-1 text-sm italic text-white/50">{t('live.translating')}</p>
            )}
            {segment.target && <p className="mt-1 text-base text-white">🇳🇴 {segment.target}</p>}
            {segment.status === 'error' && (
              <p className="mt-1 text-sm text-rose-300">
                {t('live.segmentError')}: {segment.error}
              </p>
            )}
          </div>
        ))}
        <div ref={listEndRef} />
      </div>
    </section>
  );
}

export default LiveTranslatePanel;
