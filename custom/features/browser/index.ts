/**
 * index.ts - Browser feature entry point
 *
 * Registers browser tools and handles lifecycle
 */
import type { BrowserOnlyConfig } from './types'
import { loadConfig } from './config'
import { BrowserManager, shotDir, pdfDir, downloadsDirDefault } from './browser/impl'
import { getBrowserTools } from './tool'
import { readdir, unlink, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const SCREENSHOT_PREFIX = 'pi-screenshot-'
const MAX_SCREENSHOTS = 20

async function cleanScreenshots(): Promise<void> {
  try {
    const dir = shotDir()
    const files = await readdir(dir)
    await Promise.all(
      files
        .filter(f => f.startsWith(SCREENSHOT_PREFIX))
        .map(f => unlink(join(dir, f)).catch(() => {}))
    )
  } catch { /* ignore */ }
}

async function cleanPdf(): Promise<void> {
  try {
    await rm(pdfDir(), { recursive: true, force: true })
  } catch { /* ignore */ }
}

async function cleanDownloads(): Promise<void> {
  try {
    await rm(downloadsDirDefault(), { recursive: true, force: true })
  } catch { /* ignore */ }
}

export async function cleanStaleTempDirs(): Promise<void> {
  const pattern = /^pi-browser-(?:screenshots|pdf|downloads)-(\d+)$/
  try {
    const entries = await readdir(tmpdir())
    await Promise.all(entries.map(async name => {
      const m = name.match(pattern)
      if (!m) return
      const pid = Number(m[1])
      if (pid === process.pid || pid <= 0) return
      try {
        process.kill(pid, 0)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
          await rm(join(tmpdir(), name), { recursive: true, force: true }).catch(() => {})
        }
      }
    }))
  } catch { /* ignore */ }
}

async function trimScreenshots(): Promise<void> {
  try {
    const dir = shotDir()
    const files = (await readdir(dir))
      .filter(f => f.startsWith(SCREENSHOT_PREFIX))
      .sort()
    if (files.length > MAX_SCREENSHOTS) {
      await Promise.all(
        files
          .slice(0, files.length - MAX_SCREENSHOTS)
          .map(f => unlink(join(dir, f)).catch(() => {}))
      )
    }
  } catch { /* ignore */ }
}

export interface BrowserFeature {
  config: BrowserOnlyConfig
  browser: BrowserManager
  tools: ReturnType<typeof getBrowserTools>
  shutdown: () => Promise<void>
  compact: () => Promise<void>
  start: () => Promise<void>
}

export async function createBrowserFeature(): Promise<BrowserFeature> {
  const config: BrowserOnlyConfig = loadConfig()
  const browser = new BrowserManager(config.browser)

  const recordUsage = (name: string, tokens: number) => {
    // Placeholder for token tracking
  }

  const tools = getBrowserTools(browser, recordUsage, config.browser.viewport_height)

  return {
    config,
    browser,
    tools,
    shutdown: async () => {
      await browser.close()
      await cleanScreenshots()
      await cleanPdf()
      await cleanDownloads()
    },
    compact: async () => {
      await trimScreenshots()
    },
    start: async () => {
      void cleanStaleTempDirs()
    },
  }
}

export { BrowserManager, shotDir, pdfDir, downloadsDirDefault } from './browser/impl'
export type { BrowserConfig, PageInfo, NetworkEntry, DialogMode, DownloadFile, BrowserOnlyConfig } from './types'
export type { BrowserTool } from './tool'