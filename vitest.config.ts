import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const source = (pkg: string) => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@feature-almanac/schema': source('schema'),
      '@feature-almanac/core': source('core'),
      '@feature-almanac/site': source('site'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
})
