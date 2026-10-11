/** Descending observed values; unknown/non-finite values never become zero. */
export function compareNullableDescending(a: number | null | undefined, b: number | null | undefined): number {
  const left = a != null && Number.isFinite(a) ? a : null
  const right = b != null && Number.isFinite(b) ? b : null
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left > right ? -1 : 1
}
