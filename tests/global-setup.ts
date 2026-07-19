import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Build dist/ once per test run so tests always exercise current src/. */
export default function setup(): void {
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
}
