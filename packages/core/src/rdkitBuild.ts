/** npm package that supplies the WASM the app, CLI and MCP all load. */
export const RDKIT_NPM_VERSION = '2025.3.4-1.0.0';

/**
 * SHA-256 of `@rdkit/rdkit` `dist/RDKit_minimal.wasm` at `RDKIT_NPM_VERSION`.
 * Stamped into `models.rdkitjs` so a decision record names the bytes that ran,
 * not only `RDKit.version()`. A unit test checks this against the installed file.
 */
export const RDKIT_WASM_SHA256 = 'sha256:e0967d44fed59e44a2d07bfc08f3a86821c54a14c95bb7e6e392fe867333b8c8';
