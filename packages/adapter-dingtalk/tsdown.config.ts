import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  dts: true,
  sourcemap: true,
  platform: 'node',
  target: 'node18',
  outDir: 'dist',
  external: ['chat'],
});
