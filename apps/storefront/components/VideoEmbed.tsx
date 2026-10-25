"use client";

import { useEffect, useRef, useState } from 'react';

interface Props {
  url: string;
}

type VideoType = 'youtube' | 'facebook' | null;

function parseVideoUrl(url: string): { type: VideoType; id: string | null } {
  const trimmed = url.trim();

  // YouTube patterns
  const ytPatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of ytPatterns) {
    const match = trimmed.match(pattern);
    if (match) return { type: 'youtube', id: match[1] };
  }

  // Facebook patterns
  const fbPatterns = [
    /facebook\.com\/(?:watch\/?\?v=\d+|reel\/\d+|video\/\d+|share\/\d+|plugins\/video\.php\?href=)/,
    /fb\.watch\//,
    /facebook\.com\/[^/]+\/videos\/\d+/,
  ];
  for (const pattern of fbPatterns) {
    if (pattern.test(trimmed)) return { type: 'facebook', id: trimmed };
  }

  return { type: null, id: null };
}

function YouTubeEmbed({ videoId }: { videoId: string }) {
  // Click-to-play facade: the ~500KB YouTube player JS loads only after the
  // shopper actually wants the video. Thumbnail is lazy too.
  const [play, setPlay] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  if (play) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&controls=1&modestbranding=1&autoplay=1`}
        title="Product video"
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full rounded-lg"
        style={{ border: 'none' }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setPlay(true)}
      aria-label="Play product video"
      className="absolute inset-0 w-full h-full p-0 border-0 cursor-pointer bg-gray-100"
    >
      {!thumbFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
          alt=""
          loading="lazy"
          onError={() => setThumbFailed(true)}
          className="absolute inset-0 w-full h-full object-cover rounded-lg"
        />
      )}
      <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <span className="flex w-14 h-14 items-center justify-center rounded-full bg-black/60">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>
    </button>
  );
}

type FbPhase = 'facade' | 'loading' | 'failed';

function FacebookEmbed({ url, onFailed }: { url: string; onFailed: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<FbPhase>('facade');
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;

  useEffect(() => {
    if (phase !== 'loading') return;
    if (typeof window === 'undefined') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      if (!cancelled) onFailedRef.current();
    };

    const render = () => {
      const fb = (window as any).FB;
      if (!fb || cancelled) return;
      try {
        fb.XFBML.parse(containerRef.current);
      } catch {
        fail();
        return;
      }
      // FB.XFBML.parse is fire-and-forget: it reports success even when the
      // plugin cannot render the URL (private video, rejected link form,
      // blocked SDK). The only reliable signal is an iframe appearing in
      // the plugin node — if none appears, the parent collapses the whole
      // box to a link chip instead of leaving a permanently blank 16/9 box.
      timer = setTimeout(() => {
        if (cancelled) return;
        const rendered = containerRef.current?.querySelector('iframe');
        if (!rendered) fail();
      }, 6000);
    };

    const existing = document.getElementById('fb-sdk') as HTMLScriptElement | null;
    if ((window as any).FB) {
      render();
    } else if (existing) {
      existing.addEventListener('load', render);
      existing.addEventListener('error', fail);
    } else {
      const script = document.createElement('script');
      script.id = 'fb-sdk';
      script.src = 'https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v18.0';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.onload = render;
      script.onerror = fail;
      document.body.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase]);

  if (phase === 'facade') {
    // Tap-to-play facade, like YouTube: no Facebook SDK bytes on PDP mount
    // (weak networks, low-end phones), no player until the shopper asks.
    return (
      <button
        type="button"
        onClick={() => setPhase('loading')}
        aria-label="Play product video on Facebook"
        className="absolute inset-0 w-full h-full p-0 border-0 cursor-pointer bg-gray-100 rounded-lg flex flex-col items-center justify-center gap-2"
      >
        <span className="flex w-14 h-14 items-center justify-center rounded-full bg-black/60" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        <span className="text-[13px] text-gray-500">Watch on Facebook</span>
      </button>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full flex items-center justify-center bg-gray-50 rounded-lg overflow-hidden">
      <div
        className="fb-video"
        data-href={url}
        data-width="auto"
        data-height="100%"
        data-show-text="false"
        data-autoplay="false"
      />
    </div>
  );
}

export default function VideoEmbed({ url }: Props) {
  const { type, id } = parseVideoUrl(url);
  const [fbFailed, setFbFailed] = useState(false);

  // Nothing renders — no label, no margin, no aspect box — unless the URL
  // parses. This is the "never blank again" gate for the no-video case.
  if (!type || !id) return null;

  // A Facebook video the plugin cannot render collapses to a small chip
  // (no aspect box at all) instead of a blank 16/9 rectangle.
  if (fbFailed) {
    return (
      <div className="w-full mb-6 animate-fadeIn">
        <span className="text-[11px] text-gray-400 uppercase tracking-wider mb-2 block">Product Video</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 hover:border-gray-300"
        >
          <span aria-hidden="true">▶</span> Watch video on Facebook
        </a>
      </div>
    );
  }

  return (
    <div className="w-full mb-6 animate-fadeIn">
      <span className="text-[11px] text-gray-400 uppercase tracking-wider mb-2 block">Product Video</span>
      <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
        <div className="absolute inset-0 rounded-lg overflow-hidden shadow-sm border border-gray-100">
          {type === 'youtube' && <YouTubeEmbed videoId={id} />}
          {type === 'facebook' && <FacebookEmbed url={id} onFailed={() => setFbFailed(true)} />}
        </div>
      </div>
    </div>
  );
}
