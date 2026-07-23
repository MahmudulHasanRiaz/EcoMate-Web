export interface ClientConfig {
  clientId: string;
  displayName: string;
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
