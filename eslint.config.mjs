import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  {
    ignores: ['main.js', 'node_modules/**', '.test-build/**', 'scripts/**', 'esbuild.config.mjs', 'eslint.config.mjs', 'test/**'],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
