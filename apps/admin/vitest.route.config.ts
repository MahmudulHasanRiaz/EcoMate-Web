/// <reference types="vitest/config" />
import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    name: 'route-integration',
    include: ['src/__tests__/route-integration.test.ts'],
    environment: 'node',
    globals: true,
  },
})
