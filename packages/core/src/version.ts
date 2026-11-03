// @paretomol/core version. Node reads package.json (this file's parent in
// source, and the package root when compiled to dist/). The browser bundle
// replaces this module with the same version string.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function readVersion(): string {
  const pkg = require('../package.json') as { version?: string };
  if (typeof pkg.version !== 'string' || pkg.version === '') {
    throw new Error('@paretomol/core: package.json has no version');
  }
  return pkg.version;
}

export const CORE_VERSION = readVersion();
