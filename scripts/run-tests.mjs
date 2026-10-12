// Compiles the unit tests with esbuild, then runs them with the Node test runner.
import esbuild from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const outdir = '.test-build';
rmSync(outdir, { recursive: true, force: true });

const entryPoints = readdirSync('test')
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => join('test', f));

await esbuild.build({
  entryPoints,
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});

const files = readdirSync(outdir).map((f) => join(outdir, f));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
