#!/usr/bin/env node
import { serveStdio } from '../dist/server.js';
serveStdio().catch((err) => {
  console.error(err);
  process.exit(1);
});
