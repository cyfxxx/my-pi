/**
 * services/tool-system/render-utils.ts - 渲染工具
 *
 * 从 packages/coding-agent/src/core/tools/render-utils.ts 提取
 * 简化版本，移除外部依赖
 */

import { sep } from "node:path"

/**
 * 路径缩写
 */
export function shortenPath(path: unknown): string {
  if (typeof path !== "string") {
    return String(path)
  }
  
  const homeDir = process.env.HOME || "~"
  
  if (path.startsWith(homeDir)) {
    return "~" + path.slice(homeDir.length)
  }
  
  return path
}

/**
 * 替换 Tab
 */
export function replaceTabs(text: string): string {
  return text.replace(/\t/g, "  ")
}

/**
 * 提取文本输出
 */
export function getTextOutput(content: unknown): string {
  if (typeof content === "string") {
    return content
  }
  
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item
        }
        if (item && typeof item === "object" && "text" in item) {
          return (item as { text: string }).text
        }
        return ""
      })
      .join("\n")
  }
  
  if (content && typeof content === "object" && "text" in content) {
    return (content as { text: string }).text
  }
  
  return ""
}

/**
 * 去除 ANSI 转义码
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
}
