import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";
import { Search } from "lucide-react";
import {
  resolveOriginalImageUrl,
  resolveImageUrl,
  type ImageTransform,
  type MediaSource,
} from "../lib/media";

const ERROR_PLACEHOLDER =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <rect width="400" height="400" fill="#f1f5f9"/>
      <g transform="translate(200,160)" fill="#cbd5e1" opacity="0.65">
        <rect x="-28" y="-21" width="56" height="42" rx="5"/>
        <circle cx="10" cy="-6" r="8" fill="#f1f5f9"/>
        <path d="M-22 14l14-14 10 10 8-8 16 19h-48z" fill="#f1f5f9"/>
      </g>
      <text x="200" y="230" font-family="system-ui,sans-serif" font-size="14"
        fill="#94a3b8" text-anchor="middle" font-weight="600">Image unavailable</text>
    </svg>`,
  );

export function safeImageUrl(
  src?: MediaSource,
  transform?: ImageTransform,
): string | undefined {
  return resolveImageUrl(src, transform);
}

interface SafeImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src"
> {
  src?: MediaSource;
  resizeWidth?: number;
  resizeHeight?: number;
  quality?: number;
  fit?: ImageTransform["fit"];
  version?: ImageTransform["version"];
}

type ImageAttempt = "resolved" | "original" | "placeholder";

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000] as const;

function retryUrl(src: string, retryToken: number): string {
  if (retryToken === 0 || src.startsWith("data:") || src.startsWith("blob:")) {
    return src;
  }

  // The resize endpoint is controlled by this deployment and safely ignores
  // the cache-busting parameter. Do not mutate direct R2/S3 URLs because they
  // may be signed; remounting the img is enough to retry those.
  if (!src.includes("/images/resize")) return src;

  const hashIndex = src.indexOf("#");
  const base = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
  const hash = hashIndex >= 0 ? src.slice(hashIndex) : "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}pos_retry=${retryToken}${hash}`;
}

interface RecoveringImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src"
> {
  resolvedSrc: string;
  originalSrc?: string;
}

function RecoveringImage({
  resolvedSrc,
  originalSrc,
  alt,
  className,
  onError,
  onLoad,
  loading,
  ...imgProps
}: RecoveringImageProps) {
  const [attempt, setAttempt] = useState<ImageAttempt>("resolved");
  const [retryToken, setRetryToken] = useState(0);
  const attemptRef = useRef<ImageAttempt>("resolved");
  const retryCountRef = useRef(0);

  const updateAttempt = useCallback((next: ImageAttempt) => {
    attemptRef.current = next;
    setAttempt(next);
  }, []);

  const retryNow = useCallback(() => {
    if (attemptRef.current !== "placeholder") return;
    retryCountRef.current += 1;
    setRetryToken((current) => current + 1);
    updateAttempt("resolved");
  }, [updateAttempt]);

  useEffect(() => {
    if (attempt !== "placeholder") return;
    const delay =
      RETRY_DELAYS_MS[
        Math.min(retryCountRef.current, RETRY_DELAYS_MS.length - 1)
      ];
    const timeout = window.setTimeout(retryNow, delay);
    return () => window.clearTimeout(timeout);
  }, [attempt, retryNow]);

  useEffect(() => {
    if (attempt !== "placeholder") return;
    const retryWhenAvailable = () => retryNow();
    window.addEventListener("online", retryWhenAvailable);
    window.addEventListener("focus", retryWhenAvailable);
    return () => {
      window.removeEventListener("online", retryWhenAvailable);
      window.removeEventListener("focus", retryWhenAvailable);
    };
  }, [attempt, retryNow]);

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    onError?.(event);
    if (
      attemptRef.current === "resolved" &&
      originalSrc &&
      originalSrc !== resolvedSrc
    ) {
      updateAttempt("original");
      return;
    }
    if (attemptRef.current !== "placeholder") {
      updateAttempt("placeholder");
    }
  };

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    if (attemptRef.current !== "placeholder") {
      retryCountRef.current = 0;
    }
    onLoad?.(event);
  };

  const activeSrc =
    attempt === "placeholder"
      ? ERROR_PLACEHOLDER
      : attempt === "original" && originalSrc
        ? originalSrc
        : retryUrl(resolvedSrc, retryToken);

  return (
    <img
      {...imgProps}
      key={`${attempt}-${retryToken}`}
      src={activeSrc}
      alt={alt || ""}
      className={className}
      onError={handleError}
      onLoad={handleLoad}
      loading={loading || "lazy"}
      data-image-attempt={attempt}
    />
  );
}

export function SafeImage({
  src,
  alt,
  className,
  resizeWidth,
  resizeHeight,
  quality = 80,
  fit = "cover",
  version,
  onError,
  ...imgProps
}: SafeImageProps) {
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 text-slate-300 ${className || ""}`}
        style={
          className?.includes("h-full")
            ? {}
            : { width: "100%", aspectRatio: "1" }
        }
      >
        <Search size={26} className="opacity-45" />
      </div>
    );
  }

  const resolvedSrc = safeImageUrl(src, {
    width: resizeWidth,
    height: resizeHeight,
    quality,
    fit,
    version,
  });
  const originalSrc = resolveOriginalImageUrl(src, version);

  if (!resolvedSrc) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 text-slate-300 ${className || ""}`}
      >
        <Search size={26} className="opacity-45" />
      </div>
    );
  }

  return (
    <RecoveringImage
      key={`${resolvedSrc}\u0000${originalSrc || ""}`}
      {...imgProps}
      resolvedSrc={resolvedSrc}
      originalSrc={originalSrc}
      alt={alt || ""}
      className={className}
      onError={onError}
    />
  );
}
