// Structured diagnostics (ADR-0030). One stable record shape for every
// severity; positioned errors carry 1-based line/col.

/** Only 'error' fails a command's exit code (ADR-0030 §5); 'warning'/'info' never do. */
export type Severity = 'error' | 'warning' | 'info'

/**
 * The one stable record shape emitted for every severity, on both the `--json`
 * and human-readable surfaces (ADR-0030 §1, §4).
 */
export type Diagnostic = {
  readonly severity: Severity
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly endLine?: number
  readonly endColumn?: number
  readonly hint?: string
}

/** A 1-based line/column position in source. */
export type TextPosition = { readonly line: number; readonly column: number }

/**
 * A 1-based start position with an optional end, half-checked against the source
 * (ADR-0030 §1). Carried by DrawsticError and copied onto its Diagnostic.
 */
export type TextSpan = {
  readonly line: number
  readonly column: number
  readonly endLine?: number
  readonly endColumn?: number
}

/**
 * A positioned Drawstic error. Thrown during lex/parse/eval; caught at the
 * CLI boundary and rendered as a diagnostic record.
 */
export class DrawsticError extends Error {
  readonly code: string
  readonly file: string
  readonly span: TextSpan
  readonly hint: string | undefined

  constructor(code: string, message: string, file: string, span: TextSpan, hint?: string) {
    super(message)
    this.name = 'DrawsticError'
    this.code = code
    this.file = file
    this.span = span
    this.hint = hint
  }

  toDiagnostic(): Diagnostic {
    return {
      severity: 'error',
      code: this.code,
      message: this.message,
      file: this.file,
      line: this.span.line,
      column: this.span.column,
      ...(this.span.endLine === undefined ? {} : { endLine: this.span.endLine }),
      ...(this.span.endColumn === undefined ? {} : { endColumn: this.span.endColumn }),
      ...(this.hint === undefined ? {} : { hint: this.hint }),
    }
  }
}

export const error = (
  code: string,
  message: string,
  file: string,
  span: TextSpan,
  hint?: string,
): DrawsticError => new DrawsticError(code, message, file, span, hint)

/**
 * Render a diagnostic in the human-readable positioned form. The human form
 * is a rendering of the record — same code, position, hint (ADR-0030 §4).
 */
export const formatDiagnostic = (d: Diagnostic): string => {
  const head = `${d.file}:${d.line}:${d.column} ${d.severity} ${d.code}: ${d.message}`
  return d.hint ? `${head}\n  hint: ${d.hint}` : head
}

// Stable diagnostic codes (ADR-0030). Public API — never renumber.
export const ERROR_CODE = {
  unknownName: 'E001',
  pixelsSizeMismatch: 'E002',
  sizeUnresolved: 'E003',
  syntax: 'E004',
  indent: 'E005',
  typeError: 'E006',
  paletteCollision: 'E007',
  importError: 'E008',
  // E009 retired (ADR-0088): the `drawstic N` pragma is inert, so no version boundary can be
  // violated. Slot reserved — never renumber or reuse.
  budget: 'E010',
  arity: 'E011',
  badFlag: 'E012',
  regionDropped: 'E013',
  nonInvertible: 'E014',
  indexError: 'E015',
  tileSize: 'E016',
  fontError: 'E017',
  exportError: 'E018',
  ioError: 'E019',
  shaMismatch: 'E020',
  format: 'E021',
  renderTarget: 'E022',
  diffMismatch: 'E023',
  noLight: 'E024',
  occlusionCycle: 'E025',
  unknownFlag: 'E026',
  pngUnsupported: 'E027',
} as const
