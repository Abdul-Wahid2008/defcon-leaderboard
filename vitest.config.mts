import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { 'server-only': path.resolve(import.meta.dirname, './tests/helpers/server-only-mock.ts') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    alias: { 'server-only': path.resolve(import.meta.dirname, './tests/helpers/server-only-mock.ts') },
  },
});
