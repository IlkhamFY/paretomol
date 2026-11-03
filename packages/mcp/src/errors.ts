/** Stable codes an agent can branch on. The message is for a person. */
export const ToolErrorCode = {
  too_many_molecules: 'too_many_molecules',
  smiles_too_long: 'smiles_too_long',
  limit_too_high: 'limit_too_high',
  invalid_input: 'invalid_input',
  unknown_profile: 'unknown_profile',
  review_url_too_long: 'review_url_too_long',
  not_found: 'not_found',
  tool_error: 'tool_error',
} as const;

export type ToolErrorCode = typeof ToolErrorCode[keyof typeof ToolErrorCode];

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}
