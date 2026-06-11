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
  return (
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&controls=1&modestbranding=1`}
      title="Product video"
      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      className="absolute inset-0 w-full h-full rounded-lg"
      style={{ border: 'none' }}
    />
  );
}

function FacebookEmbed({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const init = () => {
      if ((window as any).FB) {
        (window as any).FB.XFBML.parse(containerRef.current);
        setLoaded(true);
      }
    };

    if (!(window as any).FB) {
      const script = document.createElement('script');
      script.src = 'https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v18.0';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.onload = init;
      script.onerror = () => setLoaded(false);
      document.body.appendChild(script);
    } else {
      init();
    }
  }, []);

  if (!loaded) {
    return (
      <div ref={containerRef} className="absolute inset-0 w-full h-full flex items-center justify-center bg-gray-50 rounded-lg overflow-hidden">
        <span className="text-[13px] text-gray-400">Failed to load video</span>
      </div>
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

  if (!type || !id) return null;

  return (
    <div className="w-full mb-6 animate-fadeIn">
      <span className="text-[11px] text-gray-400 uppercase tracking-wider mb-2 block">Product Video</span>
      <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
        <div className="absolute inset-0 rounded-lg overflow-hidden shadow-sm border border-gray-100">
          {type === 'youtube' && <YouTubeEmbed videoId={id} />}
          {type === 'facebook' && <FacebookEmbed url={id} />}
        </div>
      </div>
    </div>
  );
}
