import { readFile, writeFile, access, stat, mkdir, rm, readdir } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { glob } from 'tinyglobby'
import type {
  FSProvider,
  FSService,
  FSReadOptions,
  FSReadResult,
  FSWriteOptions,
  FSEdit,
  FSEditOptions,
  FSEditResult,
  GrepOptions,
  GrepResult,
  GrepMatch,
  FindOptions,
  FindResult,
  LSOptions,
  LSResult,
  FSEntry,
  FSStat,
} from './types.ts'

/** 本地文件系统 Provider */
export const localFSProvider: FSProvider = {
  name: 'local',
  seam: 'fs',
  description: '本地文件系统操作',
  impl: {
    async readFile(path: string, options?: FSReadOptions): Promise<FSReadResult> {
      const content = await readFile(path, { encoding: options?.encoding ?? 'utf-8' })
      const truncated = options?.limit !== undefined && content.length > options.limit
      const result = truncated ? content.slice(0, options.limit) : content
      return { content: result, size: content.length, truncated }
    },

    async writeFile(path: string, content: string, options?: FSWriteOptions): Promise<void> {
      if (options?.mkdir) {
        await mkdir(dirname(path), { recursive: true })
      }
      await writeFile(path, content, { encoding: options?.encoding ?? 'utf-8' })
    },

    async editFile(path: string, edits: FSEdit[], options?: FSEditOptions): Promise<FSEditResult> {
      let content = await readFile(path, 'utf-8')
      let changes = 0

      for (const edit of edits) {
        if (edit.replaceAll) {
          const count = countOccurrences(content, edit.oldString)
          content = content.split(edit.oldString).join(edit.newString)
          changes += count
        } else {
          if (content.includes(edit.oldString)) {
            content = content.replace(edit.oldString, edit.newString)
            changes++
          }
        }
      }

      if (!options?.dryRun && changes > 0) {
        await writeFile(path, content, 'utf-8')
      }

      return { success: changes > 0, changes }
    },

    async grep(pattern: string, options?: GrepOptions): Promise<GrepResult> {
      const searchPath = options?.path ?? '.'
      const include = options?.include
      const exclude = options?.exclude

      try {
        const files = await glob(
          [include ?? '**/*'],
          {
            cwd: searchPath,
            ignore: exclude ? [exclude] : [],
            onlyFiles: true,
          }
        )

        const matches: GrepMatch[] = []
        const regex = new RegExp(pattern, options?.caseSensitive ? 'g' : 'gi')

        for (const file of files) {
          if (options?.maxResults && matches.length >= options.maxResults) break

          try {
            const content = await readFile(join(searchPath, file), 'utf-8')
            const lines = content.split('\n')

            for (let i = 0; i < lines.length; i++) {
              if (options?.maxResults && matches.length >= options.maxResults) break

              if (regex.test(lines[i])) {
                matches.push({
                  file,
                  line: i + 1,
                  content: lines[i].trim(),
                })
              }
              regex.lastIndex = 0
            }
          } catch {
            // 跳过无法读取的文件
          }
        }

        return { matches, totalMatches: matches.length }
      } catch {
        return { matches: [], totalMatches: 0 }
      }
    },

    async find(pattern: string, options?: FindOptions): Promise<FindResult> {
      const searchPath = options?.path ?? '.'

      try {
        const files = await glob([pattern], {
          cwd: searchPath,
          onlyFiles: options?.type === 'file',
          onlyDirectories: options?.type === 'directory',
          deep: options?.maxDepth,
        })

        return { files }
      } catch {
        return { files: [] }
      }
    },

    async ls(path: string, options?: LSOptions): Promise<LSResult> {
      try {
        const entries = await readdir(path, { withFileTypes: true })
        const result: FSEntry[] = entries
          .filter(e => options?.includeHidden || !e.name.startsWith('.'))
          .map(e => ({
            name: e.name,
            path: join(path, e.name),
            type: e.isDirectory() ? 'directory' as const : 'file' as const,
          }))

        return { entries: result }
      } catch {
        return { entries: [] }
      }
    },

    async exists(path: string): Promise<boolean> {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },

    async stat(path: string): Promise<FSStat> {
      const s = await stat(path)
      return {
        size: s.size,
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        created: s.birthtime,
        modified: s.mtime,
      }
    },

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      await mkdir(path, { recursive: options?.recursive })
    },

    async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      await rm(path, { recursive: options?.recursive, force: options?.force })
    },
  },
}

/** 计算字符串出现次数 */
function countOccurrences(str: string, search: string): number {
  let count = 0
  let pos = 0
  while ((pos = str.indexOf(search, pos)) !== -1) {
    count++
    pos += search.length
  }
  return count
}
