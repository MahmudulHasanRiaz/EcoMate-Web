import type { ComponentType } from "react";
import CareersTemplate from "./pages/careers";
import AboutTemplate from "./pages/about";
import CompanyTemplate from "./pages/company";
import FaqTemplate from "./pages/faq";
import ContactTemplate from "./pages/contact";
import StoresTemplate from "./pages/stores";
import DeliveryAreasTemplate from "./pages/delivery-areas";
import TermsConditionsTemplate from "./pages/terms-conditions";
import PrivacyPolicyTemplate from "./pages/privacy-policy";
import RefundPolicyTemplate from "./pages/refund-policy";
import ExchangePolicyTemplate from "./pages/exchange-policy";
import ShippingPolicyTemplate from "./pages/shipping-policy";
import DownloadTemplate from "./pages/download";
import type { PageMeta } from "./content-utils";

export interface PreFormattedPageDefinition {
  slug: string;
  title: string;
  description: string;
  defaultConfig: Record<string, any>;
  component: ComponentType<{
    config: Record<string, any>;
    storeName?: string;
    pageMeta?: PageMeta;
    // Live delivery charge / free-delivery minimum from the storefront
    // config (renderPreFormattedPage). Only the shipping-policy template
    // reads them; every other template ignores them.
    deliveryCharge?: number;
    freeDeliveryMin?: number;
  }>;
}

export const preFormattedPages: Record<string, PreFormattedPageDefinition> = {
  careers: {
    slug: "careers",
    title: "Careers",
    description: "Open positions, benefits, and how to apply.",
    defaultConfig: {
      hero: { title: "", subtitle: "", image: "" },
      jobs: [],
      benefits: [],
      application: { email: "", ctaText: "Send Spontaneous CV" },
    },
    component: CareersTemplate,
  },
  about: {
    slug: "about",
    title: "About Us",
    description: "Our story, values, and mission.",
    defaultConfig: {
      story: "",
      tagline: "",
      values: [],
      image: "",
    },
    component: AboutTemplate,
  },
  company: {
    slug: "company",
    title: "Company",
    description: "Corporate details, certifications, and leadership.",
    defaultConfig: {
      name: "",
      registration: "",
      certifications: "",
      teamSize: "",
      ceoName: "",
      established: "",
      tagline: "",
      philosophy: "",
      vision: "",
      impact: "",
      image: "",
    },
    component: CompanyTemplate,
  },
  faq: {
    slug: "faq",
    title: "FAQ",
    description: "Frequently asked questions and answers.",
    defaultConfig: {
      items: [],
    },
    component: FaqTemplate,
  },
  contact: {
    slug: "support",
    title: "Contact / Support",
    description: "Support phone, email, address, and hours.",
    defaultConfig: {
      phone: "",
      email: "",
      address: "",
      whatsapp: "",
      hours: [],
    },
    component: ContactTemplate,
  },
  stores: {
    slug: "stores",
    title: "Stores",
    description: "Physical store locations, hours, and map links.",
    defaultConfig: {
      stores: [],
    },
    component: StoresTemplate,
  },
  "delivery-areas": {
    slug: "delivery-areas",
    title: "Delivery Areas",
    description: "Delivery zones, charges, and timeframes.",
    defaultConfig: {
      areas: [],
      freeDeliveryMin: 0,
    },
    component: DeliveryAreasTemplate,
  },
  "terms-conditions": {
    slug: "terms-conditions",
    title: "Terms & Conditions",
    description: "Terms of service document.",
    defaultConfig: {
      intro: "",
      sections: [],
    },
    component: TermsConditionsTemplate,
  },
  "privacy-policy": {
    slug: "privacy-policy",
    title: "Privacy Policy",
    description: "Privacy and data handling policy.",
    defaultConfig: {
      intro: "",
      sections: [],
    },
    component: PrivacyPolicyTemplate,
  },
  "refund-policy": {
    slug: "refund-policy",
    title: "Refund Policy",
    description: "Returns, refunds, and eligibility.",
    defaultConfig: {
      intro: "",
      sections: [],
      notice: { title: "", body: "" },
      contactEmail: "",
    },
    component: RefundPolicyTemplate,
  },
  "exchange-policy": {
    slug: "exchange-policy",
    title: "Exchange Policy",
    description: "Product exchange conditions.",
    defaultConfig: {
      intro: "",
      quote: "",
      sections: [],
    },
    component: ExchangePolicyTemplate,
  },
  "shipping-policy": {
    slug: "shipping-policy",
    title: "Shipping Policy",
    description: "Shipping times, charges, and delivery information.",
    defaultConfig: {
      intro: "",
      sections: [],
      deliveryCharge: 0,
      freeDeliveryMin: 0,
    },
    component: ShippingPolicyTemplate,
  },
  download: {
    slug: "download",
    title: "Download App",
    description: "Mobile app download links and features.",
    defaultConfig: {
      androidUrl: "",
      iosUrl: "",
      heading: "",
      description: "",
      image: "",
      features: [],
      qrCodeUrl: "",
      version: "",
      apkUrl: "",
    },
    component: DownloadTemplate,
  },
};

// Tenant-neutral defaults (above) mean a fresh tenant ships EMPTY pages —
// no invented business names, people, jobs, stores, charges or dates.
// `templateHasRealContent` is the single rule that decides whether a template
// page has real configured content (D8: content-less pages are noindex and
// omitted from the sitemap). It takes the MERGED config (defaults merged over
// the stored row, exactly what renderPreFormattedPage passes to the template)
// and returns false for the neutral defaults above.
//
// Signature:
//   templateHasRealContent(key: string, config: Record<string, any> | null | undefined): boolean
// Unknown keys and null/undefined configs return false. Never throws.

const hasText = (v: unknown): boolean =>
  typeof v === "string" && v.trim().length > 0;

const hasNonEmptySections = (config: Record<string, any>): boolean =>
  Array.isArray(config?.sections) &&
  config.sections.some(
    (s: any) => hasText(s?.heading) || hasText(s?.body),
  );

const hasItems = (config: Record<string, any>, key: string): boolean =>
  Array.isArray(config?.[key]) && config[key].length > 0;

const REAL_CONTENT_CHECKS: Record<
  string,
  (config: Record<string, any>) => boolean
> = {
  careers: (c) =>
    hasText(c?.hero?.title) ||
    hasText(c?.hero?.subtitle) ||
    hasText(c?.hero?.image) ||
    hasItems(c, "jobs") ||
    hasItems(c, "benefits"),
  about: (c) =>
    hasText(c?.story) ||
    hasText(c?.tagline) ||
    hasText(c?.image) ||
    hasItems(c, "values"),
  company: (c) =>
    hasText(c?.name) ||
    hasText(c?.registration) ||
    hasText(c?.certifications) ||
    hasText(c?.teamSize) ||
    hasText(c?.ceoName) ||
    hasText(c?.established) ||
    hasText(c?.tagline) ||
    hasText(c?.philosophy) ||
    hasText(c?.vision) ||
    hasText(c?.impact) ||
    hasText(c?.image),
  faq: (c) => hasItems(c, "items"),
  contact: (c) =>
    hasText(c?.phone) ||
    hasText(c?.email) ||
    hasText(c?.address) ||
    hasText(c?.whatsapp) ||
    hasItems(c, "hours"),
  stores: (c) => hasItems(c, "stores"),
  "delivery-areas": (c) => hasItems(c, "areas"),
  "terms-conditions": hasNonEmptySections,
  "privacy-policy": hasNonEmptySections,
  "refund-policy": (c) =>
    hasNonEmptySections(c) ||
    hasText(c?.contactEmail) ||
    hasText(c?.notice?.title) ||
    hasText(c?.notice?.body),
  "exchange-policy": hasNonEmptySections,
  "shipping-policy": hasNonEmptySections,
  download: (c) =>
    hasText(c?.androidUrl) ||
    hasText(c?.iosUrl) ||
    hasText(c?.heading) ||
    hasText(c?.description) ||
    hasText(c?.image) ||
    hasText(c?.qrCodeUrl) ||
    hasText(c?.version) ||
    hasText(c?.apkUrl) ||
    hasItems(c, "features"),
};

export function templateHasRealContent(
  key: string,
  config: Record<string, any> | null | undefined,
): boolean {
  if (!config || typeof config !== "object") return false;
  const check = REAL_CONTENT_CHECKS[key];
  if (!check) return false;
  try {
    return check(config);
  } catch {
    return false;
  }
}
