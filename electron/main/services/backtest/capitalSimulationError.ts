import type { CapitalCode } from '../../../shared/capitalSimulation'
export class CapitalError extends Error { constructor(readonly code: CapitalCode) { super(code) } }
