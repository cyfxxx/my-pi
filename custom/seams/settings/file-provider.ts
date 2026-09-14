import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SettingsProvider, SettingsService } from './types.ts'

interface FileSettingsState {
  store: Map<string, unknown>
  filePath: string
  watchers: Map<string, Set<(value: unknown) => void>>
}

/** 文件设置 Provider */
export const fileSettingsProvider: SettingsProvider = {
  name: 'file',
  seam: 'settings',
  description: '文件存储设置（JSON）',
  impl: {
    _state: {
      store: new Map<string, unknown>(),
      filePath: '',
      watchers: new Map<string, Set<(value: unknown) => void>>(),
    } as FileSettingsState,

    async init(filePath?: string): Promise<void> {
      this._state.filePath = filePath ?? '.pi/settings.json'
      await this._load()
    },

    async _load(): Promise<void> {
      try {
        const content = await readFile(this._state.filePath, 'utf-8')
        const data = JSON.parse(content)
        for (const [key, value] of Object.entries(data)) {
          this._state.store.set(key, value)
        }
      } catch {
        // 文件不存在或格式错误，使用空设置
      }
    },

    async _save(): Promise<void> {
      const dir = dirname(this._state.filePath)
      await mkdir(dir, { recursive: true })

      const data: Record<string, unknown> = {}
      for (const [key, value] of this._state.store) {
        data[key] = value
      }

      await writeFile(this._state.filePath, JSON.stringify(data, null, 2), 'utf-8')
    },

    get<T>(key: string): T | undefined {
      return this._state.store.get(key) as T | undefined
    },

    async set<T>(key: string, value: T): Promise<void> {
      const oldValue = this._state.store.get(key)
      this._state.store.set(key, value)
      await this._save()
      this._notifyWatchers(key, value, oldValue)
    },

    async delete(key: string): Promise<void> {
      const oldValue = this._state.store.get(key)
      this._state.store.delete(key)
      await this._save()
      this._notifyWatchers(key, undefined, oldValue)
    },

    all(): Record<string, unknown> {
      const data: Record<string, unknown> = {}
      for (const [key, value] of this._state.store) {
        data[key] = value
      }
      return data
    },

    onChange(key: string, callback: (value: unknown) => void): () => void {
      if (!this._state.watchers.has(key)) {
        this._state.watchers.set(key, new Set())
      }
      this._state.watchers.get(key)!.add(callback)

      return () => {
        this._state.watchers.get(key)?.delete(callback)
      }
    },

    _notifyWatchers(key: string, newValue: unknown, oldValue: unknown): void {
      if (newValue === oldValue) return
      const watchers = this._state.watchers.get(key)
      if (watchers) {
        for (const callback of watchers) {
          try {
            callback(newValue)
          } catch (error) {
            console.error(`[Settings] 变更通知错误:`, error)
          }
        }
      }
    },
  } as SettingsService & { _state: FileSettingsState; _load(): Promise<void>; _save(): Promise<void>; _notifyWatchers(key: string, newValue: unknown, oldValue: unknown): void },
}
