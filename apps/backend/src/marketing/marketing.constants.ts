export const MARKETING_PLATFORMS = [
  { slug: 'facebook', name: 'Meta Ads (Facebook)' },
  { slug: 'google_ads', name: 'Google Ads' },
  { slug: 'tiktok', name: 'TikTok Ads' },
  { slug: 'linkedin', name: 'LinkedIn Ads' },
] as const;

export const REQUEST_TIMEOUT_MS = 20_000;

export const SYNC_INTERVAL_SETTING = 'marketing_sync_interval_hours';
export const DEFAULT_SYNC_INTERVAL_HOURS = 6;

export const WEBHOOK_VERIFY_TOKEN_SETTING = 'marketing_webhook_verify_token';
export const WEBHOOK_APP_SECRET_SETTING = 'marketing_webhook_app_secret';

export const MARKETING_EXPENSE_ACCOUNT_CODE = 'marketing-expense';
export const MARKETING_EXPENSE_ACCOUNT_NAME = 'Marketing Expenses';

export const MARKETING_PREPAID_ACCOUNT_CODE = 'marketing-prepaid';
export const MARKETING_PREPAID_ACCOUNT_NAME = 'Marketing Prepaid Credit';

export const MARKETING_PAYABLE_ACCOUNT_CODE = 'marketing-payable';
export const MARKETING_PAYABLE_ACCOUNT_NAME = 'Marketing Payable';

/** System marketing accounts that must NOT appear as selectable wallets. */
export const MARKETING_SYSTEM_ACCOUNT_CODES = [
  MARKETING_EXPENSE_ACCOUNT_CODE,
  MARKETING_PREPAID_ACCOUNT_CODE,
  MARKETING_PAYABLE_ACCOUNT_CODE,
];

export const MARKETING_QUEUE = 'marketing';

export const DEFAULT_INSIGHT_LOOKBACK_DAYS = 14;