import { copyFileSync, linkSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
/** Windows keeps data next to its executable. Reuse immutable package bytes, never existing data. */
export function isolatedPackagedExecutable(executable: string, profile: string): string {
  if (process.platform !== 'win32') return executable
  const source = dirname(executable), destination = join(profile, 'release', 'win-unpacked')
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'data') continue
    const from = join(source, entry.name), to = join(destination, entry.name)
    if (entry.isDirectory()) symlinkSync(from, to, 'junction')
    else {
      try { linkSync(from, to) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        copyFileSync(from, to)
      }
    }
  }
  return join(destination, 'RT-ResearchFlow.exe')
}
