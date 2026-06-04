import { useStorefrontConfig } from "@/context/StorefrontConfigContext";

export type CatalogImageRatioPreset = "square" | "4-3" | "3-4" | "16-9";
export type CatalogImageRatioScope = "all" | "product" | "combo";

export interface CatalogImageRatio {
  mode: "preset" | "custom";
  preset?: CatalogImageRatioPreset;
  custom?: { width: number; height: number };
  scope: CatalogImageRatioScope;
}

export type ImageRatioConfig = CatalogImageRatio;

export function getAspectStyle(cfg: ImageRatioConfig | undefined):
  | { className: string }
  | { className: string; style: { aspectRatio: string } } {
  if (!cfg || cfg.mode === "preset" && (!cfg.preset || cfg.preset === "square")) {
    return { className: "aspect-square" };
  }
  if (cfg.mode === "preset") {
    const preset = cfg.preset;
    if (preset === "4-3") return { className: "aspect-[4/3]" };
    if (preset === "3-4") return { className: "aspect-[3/4]" };
    if (preset === "16-9") return { className: "aspect-video" };
    return { className: "aspect-square" };
  }
  if (cfg.custom && cfg.custom.width > 0 && cfg.custom.height > 0) {
    return { className: "w-full", style: { aspectRatio: `${cfg.custom.width}/${cfg.custom.height}` } };
  }
  return { className: "aspect-square" };
}

export function useCatalogImageStyle(scope: "product" | "combo" = "product") {
  const { config } = useStorefrontConfig();
  const ratio = config.catalogImageRatio;
  if (!ratio) return getAspectStyle(undefined);
  if (ratio.scope === "all") return getAspectStyle(ratio);
  if (ratio.scope === scope) return getAspectStyle(ratio);
  return getAspectStyle({ mode: "preset", preset: "square", scope: "all" });
}
