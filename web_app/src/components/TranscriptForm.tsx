"use client";

import { useState, useEffect } from "react";
import { PROVIDERS, LANGUAGES } from "@/lib/config";

interface TranscriptFormProps {
  onSubmit: (url: string, provider: string, length: string, lang: string) => void;
  isLoading: boolean;
  selectedUrl?: string;
}

export default function TranscriptForm({ onSubmit, isLoading, selectedUrl }: TranscriptFormProps) {
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState("anthropic");
  const [length, setLength] = useState("normal");
  const [lang, setLang] = useState("en");

  useEffect(() => {
    if (selectedUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(selectedUrl);
    }
  }, [selectedUrl]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setProvider(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    onSubmit(url, provider, length, lang);
  };

  return (
    <form onSubmit={handleSubmit} className="glass rounded-3xl p-6 flex flex-col gap-5 w-full max-w-md mx-auto shadow-sm border border-white/10 relative overflow-hidden transition-all duration-300">
      
      {/* Decorative gradient overlay */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500 opacity-80" />

      <div className="flex flex-col gap-2">
        <label htmlFor="url" className="text-sm font-medium text-[var(--foreground)] opacity-80 pl-1">
          YouTube URL
        </label>
        <div className="relative">
          <input
            id="url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded-2xl px-4 py-3.5 text-[var(--foreground)] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow appearance-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="provider" className="text-xs font-medium text-[var(--foreground)] opacity-70 pl-1">AI Provider</label>
            <div className="relative">
              <select
                id="provider"
                value={provider}
                onChange={handleProviderChange}
                className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-brand-500/50 appearance-none"
              >
                {Object.entries(PROVIDERS).filter(([, v]) => v.hasWebUI).map(([key, p]) => (
                  <option key={key} value={key}>{p.name}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none opacity-50">
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="lang" className="text-xs font-medium text-[var(--foreground)] opacity-70 pl-1">Language</label>
            <div className="relative">
              <select
                id="lang"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-brand-500/50 appearance-none"
              >
                {Object.entries(LANGUAGES).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none opacity-50">
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="length" className="text-xs font-medium text-[var(--foreground)] opacity-70 pl-1">Summary Length</label>
          <div className="relative">
            <select
              id="length"
              value={length}
              onChange={(e) => setLength(e.target.value)}
              className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-brand-500/50 appearance-none"
            >
              <option value="short">Short (Key takeaways)</option>
              <option value="normal">Normal (Detailed)</option>
              <option value="long">Long (In-depth)</option>
            </select>
            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none opacity-50">
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading || !url}
        className={`mt-2 w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-white transition-all duration-300
          ${isLoading || !url ? 'bg-[var(--card-border)] text-opacity-50 cursor-not-allowed shadow-none' : 'bg-brand-600 hover:bg-brand-700 active:scale-[0.98] shadow-lg shadow-brand-500/25'}`}
      >
        {isLoading ? (
          <>
            <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-current opacity-70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Extracting Transcript...
          </>
        ) : (
          "Prepare Summary"
        )}
      </button>
    </form>
  );
}
