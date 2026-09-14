/**
 * Seam 适配器 — 让现有扩展无缝使用 seams
 *
 * 提供兼容层，让现有代码可以逐步迁移到 seams 架构
 */

import type { EnhancedExtensionAPI } from '../integration.ts'
import type { ShellService } from './shell/types.ts'
import type { FSService } from './fs/types.ts'

// ============================================================================
// Shell 适配器（兼容 execSync 风格）
// ============================================================================

/**
 * 创建 shell 适配器 — 兼容 execSync 调用
 *
 * @example
 * ```ts
 * const shell = createShellAdapter(pi)
 * const result = await shell.exec('echo hello')
 * // 替代: const result = execSync('echo hello', { encoding: 'utf-8' })
 * ```
 */
export function createShellAdapter(pi: EnhancedExtensionAPI) {
  const shell = pi.seam.consume<ShellService>('shell')

  return {
    /** 执行命令（返回字符串） */
    async exec(command: string, options?: { timeout?: number }): Promise<string> {
      const result = await shell.execute(command, {
        timeout: options?.timeout ?? 120000,
        cwd: process.cwd(),
      })
      return result.stdout
    },

    /** 执行命令（返回完整结果） */
    async execFull(command: string, options?: { timeout?: number }) {
      return shell.execute(command, {
        timeout: options?.timeout ?? 120000,
        cwd: process.cwd(),
      })
    },

    /** 检查命令是否存在 */
    async hasCommand(command: string): Promise<boolean> {
      try {
        await shell.execute(`which ${command}`, {
          timeout: 5000,
          cwd: process.cwd(),
        })
        return true
      } catch {
        return false
      }
    },

    /** 获取 shell 信息 */
    getDefaultShell: () => shell.getDefaultShell(),
  }
}

// ============================================================================
// FS 适配器（兼容 readFileSync 风格）
// ============================================================================

/**
 * 创建 fs 适配器 — 兼容同步文件操作
 *
 * @example
 * ```ts
 * const fs = createFSAdapter(pi)
 * const content = await fs.readFile('/path/to/file')
 * // 替代: const content = readFileSync('/path/to/file', 'utf-8')
 * ```
 */
export function createFSAdapter(pi: EnhancedExtensionAPI) {
  const fs = pi.seam.consume<FSService>('fs')

  return {
    /** 读取文件 */
    async readFile(path: string): Promise<string> {
      const result = await fs.readFile(path)
      return result.content
    },

    /** 写入文件 */
    writeFile: (path: string, content: string) => fs.writeFile(path, content),

    /** 编辑文件 */
    editFile: (path: string, edits: Array<{ oldString: string; newString: string }>) =>
      fs.editFile(path, edits),

    /** 搜索文件内容 */
    grep: (pattern: string, options?: { path?: string; include?: string }) =>
      fs.grep(pattern, options),

    /** 查找文件 */
    find: (pattern: string, options?: { path?: string }) =>
      fs.find(pattern, options),

    /** 列出目录 */
    ls: (path: string, options?: { showHidden?: boolean; recursive?: boolean }) =>
      fs.ls(path, options),

    /** 检查文件是否存在 */
    exists: (path: string) => fs.exists(path),

    /** 获取文件信息 */
    stat: (path: string) => fs.stat(path),

    /** 创建目录 */
    mkdir: (path: string, options?: { recursive?: boolean }) => fs.mkdir(path, options),

    /** 删除文件或目录 */
    rm: (path: string, options?: { recursive?: boolean; force?: boolean }) =>
      fs.rm(path, options),
  }
}

// ============================================================================
// 统一适配器
// ============================================================================

/**
 * 创建所有适配器
 */
export function createAdapters(pi: EnhancedExtensionAPI) {
  return {
    shell: createShellAdapter(pi),
    fs: createFSAdapter(pi),
  }
}

// ============================================================================
// 渐进式迁移工具
// ============================================================================

/**
 * 迁移助手 — 帮助逐步替换直接 API 调用
 *
 * @example
 * ```ts
 * // 旧代码:
 * import { execSync } from 'node:child_process'
 * const result = execSync('echo hello', { encoding: 'utf-8' })
 *
 * // 新代码:
 * import { createShellAdapter } from '../seams/adapter.ts'
 * const shell = createShellAdapter(pi)
 * const result = await shell.exec('echo hello')
 * ```
 */
export const migrationGuide = {
  shell: {
    before: `import { execSync } from 'node:child_process'
const result = execSync('echo hello', { encoding: 'utf-8' })`,
    after: `const shell = createShellAdapter(pi)
const result = await shell.exec('echo hello')`,
  },
  fs: {
    before: `import { readFileSync, writeFileSync } from 'node:fs'
const content = readFileSync('/path', 'utf-8')
writeFileSync('/path', 'new content')`,
    after: `const fs = createFSAdapter(pi)
const content = await fs.readFile('/path')
await fs.writeFile('/path', 'new content')`,
  },
  sandbox: {
    before: `// 无沙箱保护`,
    after: `// 通过 shell seam 的 sandboxed 选项启用`,
  },
}
