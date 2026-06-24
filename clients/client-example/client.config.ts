import type { ClientConfig } from '@ecomate/shared-types';

const config: ClientConfig = {
  clientId: 'example-client',
  displayName: 'Example Store',
  features: {},
  overrides: {},
  branding: {
    primaryColor: '#0055FF',
    logo: '/overrides/logo.svg',
  },
};

export default config;
