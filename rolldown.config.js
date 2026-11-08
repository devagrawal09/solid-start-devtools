import { transformAsync } from '@solidjs/compiler';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';

const extensions = ['.js', '.ts', '.json', '.tsx', '.jsx'];
const builtIns = [
  'For',
  'Show',
  'Switch',
  'Match',
  'Loading',
  'Reveal',
  'Portal',
  'Repeat',
  'Dynamic',
  'Errored',
];

function solid(generate) {
  return {
    name: 'solid',
    async transform(code, id) {
      const filename = id.replace(/\?.*$/, '');
      if (/[/\\]node_modules[/\\]/.test(filename) || !/\.[mc]?[jt]sx$/i.test(filename)) {
        return null;
      }

      const result = await transformAsync(code, {
        filename,
        moduleName: '@solidjs/web',
        generate,
        sourceMap: true,
        contextToCustomElements: true,
        wrapConditionals: true,
        builtIns,
      });

      return { code: result.code, map: result.map };
    },
  };
}

function css(server = false) {
  return {
    name: 'devtools-css',
    transform(code, id) {
      if (!id.endsWith('.css')) return null;
      if (server) return { code: '', map: null, moduleType: 'js' };
      return {
        code: `const style = document.createElement('style');\nstyle.textContent = ${JSON.stringify(code)};\ndocument.head.append(style);`,
        map: null,
        moduleType: 'js',
      };
    },
  };
}

function packageVersion() {
  const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version;
  return {
    name: 'devtools-version',
    load(id) {
      if (id.endsWith('/src/version.ts')) return `export default ${JSON.stringify(version)};`;
    },
  };
}

function external(id) {
  return (
    id === 'solid-js' ||
    id.startsWith('solid-js/') ||
    id === '@solidjs/web' ||
    id.startsWith('@solidjs/web/')
  );
}

function config({ input, entryFileNames, chunkFileNames, generate, server = false }) {
  return {
    input,
    platform: server ? 'node' : 'browser',
    resolve: { extensions },
    output: {
      format: 'esm',
      dir: 'dist',
      entryFileNames,
      chunkFileNames,
      assetFileNames: 'assets/[name]-[hash][extname]',
      cleanDir: !server,
      sourcemap: true,
    },
    external,
    plugins: [css(server), packageVersion(), solid(generate)],
  };
}

export default defineConfig([
  config({
    // One build, so the toolbar and the time-travel entry share the runtime.
    input: { index: 'src/index.tsx', 'time-travel': 'src/time-travel/index.ts' },
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    generate: 'dom',
  }),
  config({
    input: 'src/server.tsx',
    entryFileNames: 'server.js',
    chunkFileNames: 'server-chunks/[name]-[hash].js',
    generate: 'ssr',
    server: true,
  }),
  config({
    input: { noop: 'src/noop.ts', 'time-travel-noop': 'src/time-travel/noop.ts' },
    entryFileNames: '[name].js',
    chunkFileNames: 'noop-chunks/[name]-[hash].js',
    generate: 'ssr',
    server: true,
  }),
  {
    input: { index: 'src/index.tsx', 'time-travel/index': 'src/time-travel/index.ts' },
    output: {
      format: 'esm',
      dir: 'dist/types',
    },
    external,
    plugins: [dts({ emitDtsOnly: true })],
  },
]);
