export async function installFixtureWithAcknowledgement(
  install: () => Promise<unknown>,
  confirm: () => Promise<void>,
): Promise<void> {
  try { await install() }
  catch (error) {
    // A lost RPC response is not permission to repeat a side-effecting install.
    if (!String(error).includes('Execution context was destroyed, most likely because of a navigation.')) throw error
  }
  // Require the complete receipt even when the install RPC returned normally.
  await confirm()
}
