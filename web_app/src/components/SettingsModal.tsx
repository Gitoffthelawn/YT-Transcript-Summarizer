"use client";

import { useState, useEffect } from "react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (keys: { groq: string; supadata: string; transcriptApi: string }) => void;
}

export default function SettingsModal({ isOpen, onClose, onSave }: SettingsModalProps) {
  const [groqKey, setGroqKey] = useState("");
  const [supadataKey, setSupadataKey] = useState("");
  const [transcriptApiKey, setTranscriptApiKey] = useState("");

  useEffect(() => {
    if (isOpen) {
      setGroqKey(localStorage.getItem("GROQ_API_KEY") || "");
      setSupadataKey(localStorage.getItem("SUPADATA_API_KEY") || "");
      setTranscriptApiKey(localStorage.getItem("TRANSCRIPTAPI_KEY") || "");
    }
  }, [isOpen]);

  const handleSave = () => {
    if (groqKey) localStorage.setItem("GROQ_API_KEY", groqKey);
    else localStorage.removeItem("GROQ_API_KEY");

    if (supadataKey) localStorage.setItem("SUPADATA_API_KEY", supadataKey);
    else localStorage.removeItem("SUPADATA_API_KEY");

    if (transcriptApiKey) localStorage.setItem("TRANSCRIPTAPI_KEY", transcriptApiKey);
    else localStorage.removeItem("TRANSCRIPTAPI_KEY");

    onSave({ groq: groqKey, supadata: supadataKey, transcriptApi: transcriptApiKey });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] w-full max-w-md rounded-3xl p-6 shadow-2xl relative flex flex-col gap-5 animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--foreground)]">API Settings</h2>
              <p className="text-xs text-[var(--foreground)] opacity-50">Bring Your Own Key (Optional)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[var(--card-border)]/50 transition-colors text-[var(--foreground)] opacity-50 hover:opacity-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <p className="text-sm text-[var(--foreground)] opacity-70">
          Keys are stored securely in your browser&apos;s local storage and used only to bypass limits. The app uses free methods by default.
        </p>

        {/* Inputs */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--foreground)] opacity-80 pl-1">Groq API Key (Whisper AI Fallback)</label>
            <input
              type="password"
              placeholder="gsk_..."
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--foreground)] opacity-80 pl-1">Supadata API Key</label>
            <input
              type="password"
              placeholder="sk_..."
              value={supadataKey}
              onChange={(e) => setSupadataKey(e.target.value)}
              className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-all"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--foreground)] opacity-80 pl-1">TranscriptAPI.com Key</label>
            <input
              type="password"
              placeholder="Enter key..."
              value={transcriptApiKey}
              onChange={(e) => setTranscriptApiKey(e.target.value)}
              className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-2 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl text-sm font-semibold bg-[var(--card-border)]/20 hover:bg-[var(--card-border)]/50 active:scale-[0.98] text-[var(--foreground)] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-3 rounded-2xl text-sm font-semibold bg-gradient-to-r from-purple-500 to-brand-500 hover:from-purple-600 hover:to-brand-600 active:scale-[0.98] text-white transition-all shadow-lg shadow-purple-500/25"
          >
            Save Keys
          </button>
        </div>
      </div>
    </div>
  );
}
