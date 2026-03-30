import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Atomic JSON write: write to tmp file, then rename.
 * Safe against daemon crashes — either old or new file remains intact.
 * See SPEC-V2.md Section X.
 */
export function atomicWriteJsonSync(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, filePath);
}
