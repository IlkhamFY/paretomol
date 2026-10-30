#!/usr/bin/env node
import { main } from '../dist/src/main.js';
main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
