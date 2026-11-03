// Safe expression parser for computed columns
// Recursive descent parser - NO eval()

type Expr = (vars: Record<string, number>) => number;

// Token types
type TokenType = 'number' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'cmp' | 'eof';
interface Token { type: TokenType; value: string; }

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    // Skip whitespace
    if (/\s/.test(s[i])) { i++; continue; }

    // Numbers (including decimals and negatives after operators)
    if (/\d/.test(s[i]) || (s[i] === '.' && i + 1 < s.length && /\d/.test(s[i + 1]))) {
      let num = '';
      while (i < s.length && (/\d/.test(s[i]) || s[i] === '.')) {
        num += s[i]; i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Identifiers (property names, function names)
    if (/[a-zA-Z_]/.test(s[i])) {
      let id = '';
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
        id += s[i]; i++;
      }
      tokens.push({ type: 'ident', value: id });
      continue;
    }

    // Comparison operators (must check 2-char first)
    if (i + 1 < s.length && (s[i] + s[i + 1] === '>=' || s[i] + s[i + 1] === '<=' || s[i] + s[i + 1] === '==')) {
      tokens.push({ type: 'cmp', value: s[i] + s[i + 1] });
      i += 2;
      continue;
    }
    if (s[i] === '>' || s[i] === '<') {
      tokens.push({ type: 'cmp', value: s[i] });
      i++;
      continue;
    }

    // Operators
    if ('+-*/^'.includes(s[i])) {
      tokens.push({ type: 'op', value: s[i] });
      i++;
      continue;
    }

    // Parens and commas
    if (s[i] === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue; }
    if (s[i] === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue; }
    if (s[i] === ',') { tokens.push({ type: 'comma', value: ',' }); i++; continue; }

    throw new Error(`Unexpected character: '${s[i]}' at position ${i}`);
  }

  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

// Recursive descent parser
class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }

  private expect(type: TokenType, value?: string): Token {
    const t = this.advance();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`Expected ${value ?? type}, got '${t.value}'`);
    }
    return t;
  }

  parse(): Expr {
    const expr = this.parseAddSub();
    if (this.peek().type !== 'eof') {
      throw new Error(`Unexpected token: '${this.peek().value}'`);
    }
    return expr;
  }

  private parseAddSub(): Expr {
    let left = this.parseMulDiv();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value;
      const right = this.parseMulDiv();
      const l = left;
      left = op === '+'
        ? (vars) => l(vars) + right(vars)
        : (vars) => l(vars) - right(vars);
    }
    return left;
  }

  private parseMulDiv(): Expr {
    let left = this.parsePower();
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.advance().value;
      const right = this.parsePower();
      const l = left;
      left = op === '*'
        ? (vars) => l(vars) * right(vars)
        : (vars) => { const d = right(vars); return d === 0 ? 0 : l(vars) / d; };
    }
    return left;
  }

  private parsePower(): Expr {
    let base = this.parseUnary();
    if (this.peek().type === 'op' && this.peek().value === '^') {
      this.advance();
      const exp = this.parseUnary();
      const b = base;
      base = (vars) => Math.pow(b(vars), exp(vars));
    }
    return base;
  }

  private parseUnary(): Expr {
    if (this.peek().type === 'op' && this.peek().value === '-') {
      this.advance();
      const inner = this.parseAtom();
      return (vars) => -inner(vars);
    }
    return this.parseAtom();
  }

  private parseAtom(): Expr {
    const t = this.peek();

    // Number literal
    if (t.type === 'number') {
      this.advance();
      const n = parseFloat(t.value);
      return () => n;
    }

    // Identifier: variable or function call
    if (t.type === 'ident') {
      this.advance();
      const name = t.value;

      // Function call?
      if (this.peek().type === 'lparen') {
        return this.parseFunctionCall(name);
      }

      // Variable reference
      return (vars) => vars[name] ?? 0;
    }

    // Parenthesized expression
    if (t.type === 'lparen') {
      this.advance();
      const inner = this.parseAddSub();
      this.expect('rparen', ')');
      return inner;
    }

    throw new Error(`Unexpected: '${t.value}'`);
  }

  private parseFunctionCall(name: string): Expr {
    this.expect('lparen', '(');
    const args: Expr[] = [];
    if (this.peek().type !== 'rparen') {
      args.push(this.parseAddSub());
      while (this.peek().type === 'comma') {
        this.advance();
        args.push(this.parseAddSub());
      }
    }
    this.expect('rparen', ')');

    const fn = name.toLowerCase();

    // Special case: if(condition, trueVal, falseVal)
    // The condition is parsed as an expression; we need to re-parse with comparison
    if (fn === 'if') {
      if (args.length !== 3) throw new Error('if() requires 3 arguments: if(cond, then, else)');
      // We need to handle comparisons inside if()
      // Since our parser already parsed the first arg as an expression,
      // comparison is handled in parseComparison below
      return this.makeIfExpr(args);
    }

    switch (fn) {
      case 'log': {
        if (args.length !== 1) throw new Error('log() requires 1 argument');
        const a = args[0];
        return (vars) => { const v = a(vars); return v > 0 ? Math.log(v) : 0; };
      }
      case 'exp': {
        if (args.length !== 1) throw new Error('exp() requires 1 argument');
        const a = args[0];
        return (vars) => Math.exp(a(vars));
      }
      case 'sqrt': {
        if (args.length !== 1) throw new Error('sqrt() requires 1 argument');
        const a = args[0];
        return (vars) => { const v = a(vars); return v >= 0 ? Math.sqrt(v) : 0; };
      }
      case 'abs': {
        if (args.length !== 1) throw new Error('abs() requires 1 argument');
        const a = args[0];
        return (vars) => Math.abs(a(vars));
      }
      case 'min': {
        if (args.length !== 2) throw new Error('min() requires 2 arguments');
        const [a, b] = args;
        return (vars) => Math.min(a(vars), b(vars));
      }
      case 'max': {
        if (args.length !== 2) throw new Error('max() requires 2 arguments');
        const [a, b] = args;
        return (vars) => Math.max(a(vars), b(vars));
      }
      // Internal comparison functions generated by preprocessComparisons()
      // Returns 1 (true) or 0 (false) for use in if() conditions
      case '__gt': {
        if (args.length !== 2) throw new Error('__gt() requires 2 arguments');
        const [a, b] = args;
        return (vars) => a(vars) > b(vars) ? 1 : 0;
      }
      case '__lt': {
        if (args.length !== 2) throw new Error('__lt() requires 2 arguments');
        const [a, b] = args;
        return (vars) => a(vars) < b(vars) ? 1 : 0;
      }
      case '__gte': {
        if (args.length !== 2) throw new Error('__gte() requires 2 arguments');
        const [a, b] = args;
        return (vars) => a(vars) >= b(vars) ? 1 : 0;
      }
      case '__lte': {
        if (args.length !== 2) throw new Error('__lte() requires 2 arguments');
        const [a, b] = args;
        return (vars) => a(vars) <= b(vars) ? 1 : 0;
      }
      case '__eq': {
        if (args.length !== 2) throw new Error('__eq() requires 2 arguments');
        const [a, b] = args;
        return (vars) => a(vars) === b(vars) ? 1 : 0;
      }
      default:
        throw new Error(`Unknown function: ${name}()`);
    }
  }

  // For if() we re-use the already-parsed args. The first arg may need comparison handling.
  // Since comparisons aren't naturally part of the expression parser,
  // we handle them as: if the result is non-zero, treat as truthy.
  // For proper comparisons, users should write: if(LogP > 5, 1, 0)
  // But since our parser doesn't handle > in the main expression,
  // we extend: any arg can produce a comparison result (0 or 1).
  private makeIfExpr(args: Expr[]): Expr {
    const [cond, trueVal, falseVal] = args;
    return (vars) => cond(vars) !== 0 ? trueVal(vars) : falseVal(vars);
  }
}


/** Parse a formula expression string into an evaluator function.
 *  Supports: +, -, *, /, ^ operators; log, exp, sqrt, abs, min, max functions;
 *  if(cond, then, else); property names as variables.
 *
 *  For if() conditions with comparisons (>, <, >=, <=, ==),
 *  the condition should be a non-zero value for truthy.
 */
export function parseFormula(expr: string): (vars: Record<string, number>) => number {
  // Pre-process: handle comparison operators by converting them to function calls
  // Replace "a > b" with a subtraction that returns positive/negative
  const processed = preprocessComparisons(expr);
  const tokens = tokenize(processed);
  const parser = new Parser(tokens);
  return parser.parse();
}

// Convert comparison operators to evaluable expressions
// "if(LogP > 5, 1, 0)" -> "if(__gt(LogP, 5), 1, 0)"
// We handle this by replacing comparisons with arithmetic that produces 0/1
function preprocessComparisons(expr: string): string {
  // Replace comparisons within if() conditions
  // Match patterns like "a >= b", "a > b", "a <= b", "a < b", "a == b"
  return expr
    .replace(/([a-zA-Z0-9_.]+)\s*>=\s*([a-zA-Z0-9_.]+)/g, '(__gte($1,$2))')
    .replace(/([a-zA-Z0-9_.]+)\s*<=\s*([a-zA-Z0-9_.]+)/g, '(__lte($1,$2))')
    .replace(/([a-zA-Z0-9_.]+)\s*==\s*([a-zA-Z0-9_.]+)/g, '(__eq($1,$2))')
    .replace(/([a-zA-Z0-9_.]+)\s*>\s*([a-zA-Z0-9_.]+)/g, '(__gt($1,$2))')
    .replace(/([a-zA-Z0-9_.]+)\s*<\s*([a-zA-Z0-9_.]+)/g, '(__lt($1,$2))');
}




/** Validate a formula expression against available variables. */
export function validateFormula(expr: string, availableVars: string[]): { valid: boolean; error?: string } {
  try {
    if (!expr.trim()) return { valid: false, error: 'Empty expression' };
    const fn = parseFormula(expr);
    // Test with dummy values
    const testVars: Record<string, number> = {};
    for (const v of availableVars) testVars[v] = 1;
    fn(testVars);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Invalid expression' };
  }
}

/** Get all variable references from a formula string. */
export function getFormulaVars(expr: string): string[] {
  try {
    const tokens = tokenize(expr.replace(/>=/g, ' ').replace(/<=/g, ' ').replace(/==/g, ' ').replace(/>/g, ' ').replace(/</g, ' '));
    const vars: string[] = [];
    const FUNCS = new Set(['log', 'exp', 'sqrt', 'abs', 'min', 'max', 'if']);
    const INTERNAL = new Set(['__gt', '__lt', '__gte', '__lte', '__eq']);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'ident' && !FUNCS.has(t.value.toLowerCase()) && !INTERNAL.has(t.value)) {
        if (!vars.includes(t.value)) vars.push(t.value);
      }
    }
    return vars;
  } catch {
    return [];
  }
}
