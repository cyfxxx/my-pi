/**
 * services/tool-system/path-utils.ts - 路径解析工具
 *
 * 从 packages/coding-agent/src/core/tools/path-utils.ts 提取
 * 移除了对 ../../utils/paths.ts 的依赖
 */

import { homedir } from "node:os"
import { isAbsolute, join, resolve as nodeResolvePath } from "node:path"

const NARROW_NO_BREAK_SPACE = "\u202F"

/**
 * 展开 ~ 到主目录
 */
export function expandTilde(filePath: string): string {
  if (filePath.startsWith("~")) {
    return join(homedir(), filePath.slice(1))
  }
  return filePath
}

/**
 * 解析相对路径
 */
export function resolveRelative(basePath: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    return relativePath
  }
  return nodeResolvePath(basePath, relativePath)
}

/**
 * 尝试 macOS 截图路径变体
 */
function tryMacOSScreenshotPath(filePath: string): string {
  return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`)
}

/**
 * 尝试 NFD 变体（macOS 文件名分解形式）
 */
function tryNFDVariant(filePath: string): string {
  return filePath.normalize("NFD")
}

/**
 * 尝试弯引号变体
 */
function tryCurlyQuoteVariant(filePath: string): string {
  return filePath.replace(/'/g, "\u2019")
}

/**
 * 匹配 macOS 文件名变体
 */
export function matchMacOSVariant(filePath: string, pattern: string): boolean {
  const variants = [
    tryMacOSScreenshotPath,
    tryNFDVariant,
    tryCurlyQuoteVariant,
  ]

  for (const variantFn of variants) {
    const variant = variantFn(filePath)
    if (variant === pattern) {
      return true
    }
  }

  return false
}
