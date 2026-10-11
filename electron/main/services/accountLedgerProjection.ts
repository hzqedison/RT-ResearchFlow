import { ledgerAmount, ledgerCents, type LedgerAccount, type LedgerIssue, type LedgerRecord, type LedgerSnapshot } from '../../shared/accountLedger'

/** Book facts only: no quotes, predicted fills, order statuses or inferred available funds. */
export function projectAccountLedger(account: LedgerAccount, records: LedgerRecord[]): LedgerSnapshot {
  const zero = BigInt(0)
  let cash: bigint | null = ledgerCents(account.openingCash), feesTotal: bigint | null = zero, realized: bigint | null = zero
  const issues = new Set<LedgerIssue>()
  if (!account.openingPositionsComplete) issues.add('OPENING_POSITIONS_INCOMPLETE')
  const positions = new Map<string, { quantity: number | null; delta: number; cost: bigint | null }>()
  for (const p of account.openingPositions) positions.set(p.symbol, { quantity: p.quantity, delta: 0, cost: p.costBasis === null ? null : ledgerCents(p.costBasis) })
  const reversedIds = records.filter(r => r.event.kind === 'reversal').map(r => r.event.kind === 'reversal' ? r.event.targetEventId : '')
  const reversed = new Set(reversedIds)
  const active = records.filter(r => r.event.kind !== 'reversal' && !reversed.has(r.id))
    .sort((a, b) => (a.event.kind !== 'reversal' ? a.event.occurredAt : 0) - (b.event.kind !== 'reversal' ? b.event.occurredAt : 0) || a.revision - b.revision)
  for (const record of active) {
    const e = record.event
    if (e.kind === 'reversal') continue
    if (e.kind === 'cash') { if (cash !== null) cash += (e.direction === 'in' ? BigInt(1) : BigInt(-1)) * ledgerCents(e.amount); continue }
    const gross = ledgerCents(e.price) * BigInt(e.quantity)
    const fee = e.fees === null ? null : Object.values(e.fees).reduce((sum, value) => sum + ledgerCents(value), zero)
    if (fee === null) { issues.add('FEES_UNKNOWN'); cash = null; feesTotal = null }
    else { if (feesTotal !== null) feesTotal += fee; if (cash !== null) cash += e.side === 'buy' ? -gross - fee : gross - fee }
    const p = positions.get(e.symbol) ?? { quantity: account.openingPositionsComplete ? 0 : null, delta: 0, cost: account.openingPositionsComplete ? zero : null }
    if (e.side === 'buy') {
      if (p.quantity !== null) p.quantity += e.quantity
      p.delta += e.quantity
      p.cost = p.cost !== null && fee !== null ? p.cost + gross + fee : null
    } else {
      if (p.quantity !== null && p.quantity >= e.quantity && p.cost !== null) {
        // Allocate integer cents by weighted average; final closure consumes all residual cents.
        const removed = p.quantity === e.quantity ? p.cost : p.cost * BigInt(e.quantity) / BigInt(p.quantity)
        if (realized !== null) realized = fee === null ? null : realized + gross - fee - removed
        p.cost -= removed
      } else { p.cost = null; realized = null; issues.add('POSITION_RECONCILIATION_REQUIRED') }
      if (p.quantity !== null) {
        p.quantity -= e.quantity
        if (p.quantity < 0) { p.quantity = null; p.cost = null; issues.add('POSITION_RECONCILIATION_REQUIRED') }
      }
      p.delta -= e.quantity
    }
    positions.set(e.symbol, p)
  }
  if (cash !== null && cash < zero) issues.add('NEGATIVE_BOOK_CASH')
  const resultPositions = [...positions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, p]) => {
    if (p.cost === null) issues.add('COST_BASIS_UNKNOWN')
    return { symbol, quantity: p.quantity, quantityDelta: p.delta, costBasis: p.cost === null ? null : ledgerAmount(p.cost), availableQuantity: null }
  })
  return { account, cashBalance: cash === null ? null : ledgerAmount(cash), availableCash: null,
    feesTotal: feesTotal === null ? null : ledgerAmount(feesTotal), realizedPnl: realized === null ? null : ledgerAmount(realized),
    brokerVerified: false, basisPolicy: 'weighted-average-book', positions: resultPositions, issues: [...issues],
    records: records.slice(-100).reverse(), totalRecords: records.length, reversedIds }
}
