import { test } from '@playwright/test'
import { AcceptanceError, checkpoint, currentStage, recordFailure } from './evidence.mjs'

test('published 1.0 to 1.1: four independent native launches and durable state', async () => {
  try {
    checkpoint('module-load')
    const { NativeUpgrade } = await import('./harness')
    checkpoint('constructor')
    const harness = new NativeUpgrade()
    checkpoint('execute')
    await harness.execute()
  } catch (error) {
    recordFailure(error, currentStage(), 'TEST_BODY_FAILED')
    // The reporter and process wrapper receive no raw IPC parameters or secrets.
    throw new AcceptanceError('BLOCKED_ENVIRONMENT', 'NATIVE_TEST_FAILED')
  }
})
