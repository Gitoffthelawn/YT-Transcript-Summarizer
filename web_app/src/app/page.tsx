"use client";

import { useState, useEffect } from "react";
import TranscriptForm from "@/components/TranscriptForm";
import ActionButtons from "@/components/ActionButtons";
import { getPreset, APP_VERSION } from "@/lib/config";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function extractVideoId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|\/v\/)([0-9A-Za-z_-]{11})/);
  return match ? match[1] : null;
}

function readCache(videoId: string): { transcript: string; title: string; strategy: string } | null {
  try {
    const raw = localStorage.getItem(`yt_cache_${videoId}`);
    if (!raw) return null;
    const { transcript, title, strategy, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(`yt_cache_${videoId}`);
      return null;
    }
    return { transcript, title, strategy };
  } catch {
    return null;
  }
}

function writeCache(videoId: string, transcript: string, title: string, strategy: string) {
  try {
    localStorage.setItem(`yt_cache_${videoId}`, JSON.stringify({ transcript, title, strategy, timestamp: Date.now() }));
  } catch {}
}

type CacheChoice = {
  url: string;
  provider: string;
  length: string;
  lang: string;
  cached: { transcript: string; title: string; strategy: string };
};

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [promptReady, setPromptReady] = useState<{ text: string; provider: string; strategy: string } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [history, setHistory] = useState<{ url: string; title: string; date: string }[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | undefined>(undefined);
  const [copiedDebug, setCopiedDebug] = useState(false);
  const [pendingCacheChoice, setPendingCacheChoice] = useState<CacheChoice | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('videoHistory');
      if (saved) setHistory(JSON.parse(saved));
    } catch {}
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url') || params.get('text');
    if (urlParam) setSelectedUrl(urlParam);
  }, []);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const handleExtract = async (url: string, provider: string, length: string, lang: string, forceRefresh = false) => {
    setIsLoading(true);
    setError(null);
    setDebugLogs([]);
    setPromptReady(null);
    setPendingCacheChoice(null);

    try {
      const videoId = extractVideoId(url);

      if (videoId && !forceRefresh) {
        const cached = readCache(videoId);
        if (cached) {
          setIsLoading(false);
          setPendingCacheChoice({ url, provider, length, lang, cached });
          return;
        }
      }

      const res = await fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, lang }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.logs?.length) setDebugLogs(data.logs);
        throw new Error(data.error || "Failed to extract transcript.");
      }

      // Save to cache
      if (videoId) {
        writeCache(videoId, data.transcript, data.title || url, data.strategy || '');
      }

      // Update history
      setHistory(prev => {
        const title = data.title || url;
        const newEntry = { url, title, date: new Date().toISOString() };
        let updated = [...prev];
        const idx = updated.findIndex(h => h.url === url);
        if (idx >= 0) updated[idx] = newEntry;
        else updated.unshift(newEntry);
        localStorage.setItem('videoHistory', JSON.stringify(updated));
        return updated;
      });

      const promptInstruction = getPreset(lang, "chat", length);
      const fullPrompt = `${promptInstruction}\n\n---\n\n${data.transcript}`;
      setPromptReady({ text: fullPrompt, provider, strategy: data.strategy || '' });
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseCached = () => {
    if (!pendingCacheChoice) return;
    const { url, provider, length, lang, cached } = pendingCacheChoice;
    const promptInstruction = getPreset(lang, "chat", length);
    const fullPrompt = `${promptInstruction}\n\n---\n\n${cached.transcript}`;
    setPromptReady({ text: fullPrompt, provider, strategy: `${cached.strategy} (cached)` });
    setPendingCacheChoice(null);
    const videoId = extractVideoId(url);
    if (videoId) {
      setHistory(prev => {
        const newEntry = { url, title: cached.title, date: new Date().toISOString() };
        let updated = [...prev];
        const idx = updated.findIndex(h => h.url === url);
        if (idx >= 0) updated[idx] = newEntry;
        else updated.unshift(newEntry);
        localStorage.setItem('videoHistory', JSON.stringify(updated));
        return updated;
      });
    }
  };

  const handleRefetch = () => {
    if (!pendingCacheChoice) return;
    const { url, provider, length, lang } = pendingCacheChoice;
    setPendingCacheChoice(null);
    handleExtract(url, provider, length, lang, true);
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 w-full max-w-lg mx-auto relative z-10">

      {/* Theme Toggle Button */}
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="absolute top-6 right-6 p-2 rounded-full bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--foreground)] shadow-sm hover:scale-105 active:scale-95 transition-all z-50"
        aria-label="Toggle Theme"
      >
        {theme === "dark" ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
        )}
      </button>

      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] rounded-full bg-brand-500/10 blur-[100px]" />
        <div className="absolute top-[20%] -right-[10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[80px]" />
      </div>

      <div className="flex flex-col items-center mb-8 text-center animate-in fade-in slide-in-from-top-4 duration-500">
        <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-purple-600 rounded-2xl shadow-xl flex items-center justify-center mb-4 transform -rotate-6">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[var(--foreground)] to-gray-500">
          YT Summarizer
        </h1>
        <p className="text-sm text-[var(--foreground)] opacity-60 mt-2">
          Extract transcripts and generate AI summaries effortlessly on mobile.
        </p>
        <p className="text-xs text-[var(--foreground)] opacity-30 mt-1">v{APP_VERSION}</p>
        <p className="text-xs text-[var(--foreground)] opacity-40 mt-1">
          Made with ❤️ by{" "}
          <a
            href="https://github.com/RobertoReale"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-purple-500 dark:text-purple-400 hover:opacity-75 transition-opacity"
          >
            Roberto Reale
          </a>
        </p>
      </div>

      <div className="w-full flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-500 delay-150 fill-mode-both">
        <TranscriptForm onSubmit={handleExtract} isLoading={isLoading} selectedUrl={selectedUrl} />

        {pendingCacheChoice && (
          <div className="glass rounded-3xl p-5 flex flex-col gap-4 border border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--foreground)]">Cached transcript found</p>
                <p className="text-xs text-[var(--foreground)] opacity-50 truncate">{pendingCacheChoice.cached.title}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleUseCached}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white transition-all shadow-lg shadow-brand-500/25"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Use cached
              </button>
              <button
                onClick={handleRefetch}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold bg-[var(--card-bg)] hover:bg-[var(--card-border)]/60 active:scale-[0.98] text-[var(--foreground)] border border-[var(--card-border)] transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Re-fetch
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 p-4 rounded-2xl text-sm border border-red-200 dark:border-red-900/50 animate-in fade-in">
            <p className="font-medium text-center mb-2">{error}</p>
            {debugLogs.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs opacity-70 hover:opacity-100">Debug logs ({debugLogs.length})</summary>
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(debugLogs.join('\n'));
                      setCopiedDebug(true);
                      setTimeout(() => setCopiedDebug(false), 2000);
                    }}
                    className="text-xs px-2 py-1 rounded-lg bg-red-200 dark:bg-red-900/60 hover:bg-red-300 dark:hover:bg-red-800/60 transition-colors"
                  >
                    {copiedDebug ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="mt-1 text-xs opacity-80 whitespace-pre-wrap break-all font-mono bg-red-100 dark:bg-red-950/50 rounded-xl p-3 max-h-48 overflow-y-auto">
                  {debugLogs.join('\n')}
                </pre>
              </details>
            )}
          </div>
        )}

        {promptReady && (
          <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full mt-2">
            {promptReady.strategy && (
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs text-[var(--foreground)] opacity-50">via</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                  promptReady.strategy.startsWith('Supadata')
                    ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50'
                    : 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50'
                }`}>
                  {promptReady.strategy}
                </span>
                {promptReady.strategy.startsWith('Supadata') && !promptReady.strategy.includes('cached') && (
                  <span className="text-xs text-amber-500 dark:text-amber-400 opacity-70">uses quota (100/mo free)</span>
                )}
              </div>
            )}
            <label className="text-sm font-medium text-[var(--foreground)] opacity-80 pl-1">
              Edit Prompt (Optional)
            </label>
            <textarea
              className="w-full h-48 bg-[var(--background)] border border-[var(--card-border)] rounded-2xl p-4 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-brand-500/50 resize-y"
              value={promptReady.text}
              onChange={(e) => setPromptReady({ ...promptReady, text: e.target.value })}
            />
            <ActionButtons promptText={promptReady.text} provider={promptReady.provider} />
          </div>
        )}

        {!promptReady && history.length > 0 && (
          <div className="flex flex-col gap-3 mt-4 animate-in fade-in">
            <h3 className="text-sm font-semibold text-[var(--foreground)] opacity-80 px-2">Recent Videos</h3>
            <div className="flex flex-col gap-2">
              {history.map((item, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedUrl(item.url)}
                  className="text-left bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--card-border)]/50 transition-colors truncate"
                >
                  {item.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

    </main>
  );
}
