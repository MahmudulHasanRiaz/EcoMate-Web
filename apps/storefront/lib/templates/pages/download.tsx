import Image from "next/image";
import { Smartphone, Zap, PackageOpen, Shield } from "lucide-react";

/**
 * Feature card visual palette. The current design shows three highlight cards
 * (Faster Checkout / Order Tracking / Secure & Private) with distinct icons
 * and accent colors; feature labels come from the config and cycle through
 * this palette by index.
 */
const FEATURE_META = [
  { Icon: Zap, iconClass: "bg-green-50 text-green-600" },
  { Icon: PackageOpen, iconClass: "bg-blue-50 text-blue-600" },
  { Icon: Shield, iconClass: "bg-purple-50 text-purple-600" },
] as const;

/** Optional per-feature subtitle text preserved from the original design. */
const FEATURE_SUBTITLES: Record<string, string> = {
  "Faster Checkout": "Save details for one-tap purchases",
  "Order Tracking": "Real-time updates from dispatch to delivery",
  "Secure & Private": "Your data stays safe with encrypted checkout",
};

export default function DownloadTemplate({ config }: { config: Record<string, any> }) {
  const androidUrl = (config?.androidUrl || "").trim();
  const iosUrl = (config?.iosUrl || "").trim();
  const heading = (config?.heading || "Get the Store App").trim();
  const description = config?.description || "";
  const image = (config?.image || "").trim();
  const features: string[] = Array.isArray(config?.features) ? config.features : [];

  const hasAndroid = Boolean(androidUrl);
  const hasIos = Boolean(iosUrl);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-16">
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-blue/10 text-brand-blue rounded-full mb-4 overflow-hidden">
          {image ? (
            <Image
              src={image}
              alt={heading}
              width={64}
              height={64}
              className="w-full h-full object-cover"
            />
          ) : (
            <Smartphone size={32} />
          )}
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">{heading}</h1>
        <p className="text-gray-500 max-w-xl mx-auto">{description}</p>
      </div>

      {/* Features */}
      {features.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          {features.map((feature, index) => {
            const meta = FEATURE_META[index % FEATURE_META.length];
            const Icon = meta.Icon;
            return (
              <div key={index} className="bg-white border border-gray-100 rounded-xl p-4 text-center">
                <div className={`w-10 h-10 ${meta.iconClass} rounded-xl flex items-center justify-center mx-auto mb-3`}>
                  <Icon size={20} />
                </div>
                <h3 className="font-bold text-gray-800 text-sm mb-1">{feature}</h3>
                {FEATURE_SUBTITLES[feature] && (
                  <p className="text-gray-400 text-xs">{FEATURE_SUBTITLES[feature]}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Download buttons */}
      {(hasAndroid || hasIos) && (
        <div className="flex flex-wrap justify-center gap-3">
          {hasAndroid && (
            <a
              href={androidUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 bg-[#1a1a1a] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-black transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/>
              </svg>
              Google Play
            </a>
          )}
          {hasIos && (
            <a
              href={iosUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 bg-[#1a1a1a] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-black transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-111.3-59.9-121.2z"/>
              </svg>
              App Store
            </a>
          )}
        </div>
      )}
    </div>
  );
}
