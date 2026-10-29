import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { 'server-only': path.resolve(import.meta.dirname, './tests/helpers/server-only-mock.ts') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    alias: { 'server-only': path.resolve(import.meta.dirname, './tests/helpers/server-only-mock.ts') },
  },
});
