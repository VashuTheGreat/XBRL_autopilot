import test from 'node:test';
import { existsSync } from 'node:fs';

export function referenceAvailable(file) {
  return existsSync(new URL(`./${file}`, import.meta.url));
}

export function referenceTest(name, files, fn) {
  const missing = files.filter((file) => !referenceAvailable(file));
  const skip = missing.length ? `reference file not present: ${missing.join(', ')}` : false;
  return test(name, { skip }, fn);
}