import { revalidateWindowsInstallRepairPlan, windowsInstallRepairTypedValuesDigest } from './windowsInstallRepairPreflight'
import type { WindowsInstallRepairPlan, WindowsInstallRepairPolicy, WindowsInstallRepairSnapshot } from './windowsInstallRepairPreflight'

// Internal, independently collected evidence only. This token cannot establish
// trust in a caller-supplied policy or replace the producer/consent boundaries.
export interface WindowsRepairVerifiedPlan {
  readonly kind: 'rt-windows-revalidated-plan-v1'
  readonly policy: WindowsInstallRepairPolicy
  readonly plan: WindowsInstallRepairPlan
  readonly current: WindowsInstallRepairSnapshot
}
const verified = new WeakSet<object>()
function fail(): never { throw new Error('WINDOWS_REPAIR_PLAN_REJECTED') }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
export function verifyWindowsRepairPlanCapability(
  policy: WindowsInstallRepairPolicy, plan: WindowsInstallRepairPlan, current: WindowsInstallRepairSnapshot,
): WindowsRepairVerifiedPlan {
  // Use the existing canonical preflight algorithm, including fresh independent
  // recollection, full snapshot facts, policy binding and the original expiry.
  revalidateWindowsInstallRepairPlan(policy, plan, current)
  for (const row of current.registry) {
    for (const key of ['install', 'uninstall'] as const) {
      const state = key === 'install' ? row.installKeyState : row.uninstallKeyState
      const values = key === 'install' ? row.installValues : row.uninstallValues
      const digest = key === 'install' ? row.installValuesSha256 : row.uninstallValuesSha256
      if ((state === 'absent' ? values !== null : !Array.isArray(values)) ||
          windowsInstallRepairTypedValuesDigest(values) !== digest) fail()
    }
  }
  const token = freeze(structuredClone({ kind: 'rt-windows-revalidated-plan-v1' as const, policy, plan, current }))
  verified.add(token)
  return token
}
export function requireWindowsRepairVerifiedPlan(value: WindowsRepairVerifiedPlan) {
  if (!value || !verified.has(value)) fail()
  revalidateWindowsInstallRepairPlan(value.policy, value.plan, value.current)
  return value
}
