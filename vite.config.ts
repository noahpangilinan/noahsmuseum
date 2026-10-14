import { defineConfig } from 'vite';

export default defineConfig({
  // content/ (museum.json, rooms, art) is served as-is at the site root.
  publicDir: 'content',
  build: {
    target: 'es2022',
  },
});
