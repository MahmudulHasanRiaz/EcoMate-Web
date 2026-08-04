/**
 * Shared redaction for any provider text before it is persisted (responseBody /
 * errorMsg). The Meta/GA4 provider secrets travel in the request URL query
 * string (Decision D — that is the documented transport), so they are absent
 * from the provider's response; this is defense-in-depth against a provider
 * echoing a credential back. The primary mitigation for the URL query string
 * itself is infrastructure access-log redaction (documented in the Wave-1 notes).
 */
export function sanitizeProviderText(text: string): string {
  return text.replace(
    /(access_token|api_secret|accessToken|appsecret)=([^&\s]*)/gi,
    '$1=[REDACTED]',
  );
}