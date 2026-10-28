import { build } from 'esbuild'
import { mkdir, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
await mkdir(new URL('../lib', import.meta.url), { recursive: true })

// Host half: self-contained Node ESM. Every @deepseek-ai import is type-only,
// so the only runtime dependency inside the bundle is zod.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
})

// Client half: CommonJS module for the Harness browser module loader. React is
// supplied by the loader's shared module table; Markdown is bundled with us.
await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  define: { 'process.env.NODE_ENV': '"production"' },
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{const module={exports:{}};const exports=module.exports;`,
  },
  footer: { js: 'return module.exports;}});' },
})

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.build.json'], { stdio: 'inherit' })
