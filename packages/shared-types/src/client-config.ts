export interface ClientConfig {
  clientId: string;
  displayName: string;
  /** Base domain for this client (e.g., "fixedplus.com"). Used to derive
   *  storefront, admin, pos, and API URLs at build time. */
  domain?: string;
  features: Record<string, boolean>;
  overrides: {
    admin?: { loginLogo?: string; theme?: Record<string, string> };
    storefront?: { theme?: Record<string, string> };
  };
  branding?: {
    primaryColor: string;
    logo?: string;
    favicon?: string;
  };
}
