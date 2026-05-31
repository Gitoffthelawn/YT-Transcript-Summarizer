"use client";

import { useState } from "react";
import { CONFIG } from "@/lib/config";

interface ActionButtonsProps {
  promptText: string;
  provider: string;
  transcriptText?: string;
  transcriptTitle?: string;
}

export default function ActionButtons({ promptText, provider, transcriptText, transcriptTitle }: ActionButtonsProps) {
  const [copied, setCopied] = useState(false);

  const getProviderUrl = () => {
    return CONFIG.providerWebUrls[provider] || "https://chatgpt.com/";
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy!", err);
      // Fallback for browsers that block clipboard API
      const textArea = document.createElement("textarea");
      textArea.value = promptText;
      // iOS requires the element to be visible and editable to copy correctly
      textArea.style.cssText =
        "position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:none;outline:none;box-shadow:none;background:transparent;opacity:0;";
      textArea.readOnly = false;
      document.body.appendChild(textArea);
      textArea.focus();
      // select() truncates on iOS for large content — setSelectionRange does not
      textArea.setSelectionRange(0, promptText.length);
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error("Fallback copy failed", e);
      }
      document.body.removeChild(textArea);
    }
  };

  const handleOpen = () => {
    window.open(getProviderUrl(), '_blank');
  };

  const handleShare = async () => {
    if (!navigator.share) {
      alert("Web Share API not supported on this browser.");
      return;
    }

    // Web Share Level 2: share as .txt file — bypasses Android clipboard limit entirely
    const safeName = transcriptTitle
      ? transcriptTitle.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
      : 'transcript';
    const file = new File([promptText], `${safeName}.txt`, { type: 'text/plain' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: transcriptTitle || 'YouTube Summary', files: [file] });
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return; // user cancelled — don't fall through
        // Other error: fall through to text share
      }
    }

    // Level 1 fallback: share as plain text
    try {
      await navigator.share({ title: 'YouTube Summary Prompt', text: promptText });
    } catch (err) {
      console.error("Error sharing", err);
    }
  };

  const canShare = typeof navigator !== 'undefined' && !!navigator.share;

  const handleDownload = () => {
    const content = transcriptText || promptText;
    const safeName = transcriptTitle
      ? transcriptTitle.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
      : 'transcript';
    const blobUrl = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${safeName}.txt`;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const isLarge = promptText.length > 50_000;

  return (
    <div className="flex flex-col gap-3 mt-4 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {isLarge && (
        <p className="text-xs text-center text-[var(--foreground)] opacity-50">
          Transcript is large — Android clipboard may truncate.{" "}
          {canShare ? (
            <>Use <span className="font-semibold">Share</span> or <span className="font-semibold">Download</span> ↓</>
          ) : (
            <>Use <span className="font-semibold">Download</span> ↓</>
          )}
        </p>
      )}
      <div className="flex gap-3">
        <button
          onClick={handleCopy}
          className="flex-1 relative group overflow-hidden rounded-2xl bg-brand-600 px-6 py-4 font-semibold text-white transition-all hover:bg-brand-700 active:scale-[0.98] shadow-lg shadow-brand-500/30 flex items-center justify-center gap-2"
        >
          <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-white/0 via-white/10 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700"></span>
          {copied ? (
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Copied!
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
              Copy
            </span>
          )}
        </button>

        <button
          onClick={handleOpen}
          className="rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] px-5 py-4 font-semibold text-[var(--foreground)] transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 hover:bg-[var(--background)]"
          title="Open AI provider"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
          Open
        </button>

        <button
          onClick={handleDownload}
          className="rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] px-5 py-4 font-semibold text-[var(--foreground)] transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 hover:bg-[var(--background)]"
          title="Download transcript as .txt"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
        </button>
      </div>

      {canShare && (
        <button
          onClick={handleShare}
          className="w-full rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] px-6 py-4 font-semibold text-[var(--foreground)] transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 hover:bg-[var(--background)]"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
          Share to App
        </button>
      )}
    </div>
  );
}

