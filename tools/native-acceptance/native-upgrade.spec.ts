import { test } from '@playwright/test'
import { NativeUpgrade } from './harness'

test('published 1.0 to 1.1: four independent native launches and durable state', async () => {
  await new NativeUpgrade().execute()
})
