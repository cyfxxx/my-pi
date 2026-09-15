/**
 * services/tool-system/edit-diff.ts - Diff 工具
 *
 * 从 packages/coding-agent/src/core/tools/edit-diff.ts 提取
 * 简化版本，移除外部依赖
 */

/**
 * 模糊文本查找
 */
export function fuzzyFindText(text: string, target: string): number {
  const normalizedText = text.normalize("NFC")
  const normalizedTarget = target.normalize("NFC")
  
  // 精确匹配
  const exactIndex = normalizedText.indexOf(normalizedTarget)
  if (exactIndex !== -1) {
    return exactIndex
  }
  
  // 模糊匹配（忽略空白）
  const textNoSpace = normalizedText.replace(/\s+/g, "")
  const targetNoSpace = normalizedTarget.replace(/\s+/g, "")
  const fuzzyIndex = textNoSpace.indexOf(targetNoSpace)
  
  if (fuzzyIndex !== -1) {
    // 找到模糊匹配，计算原始位置
    let originalIndex = 0
    let normalizedIndex = 0
    
    while (normalizedIndex < fuzzyIndex && originalIndex < normalizedText.length) {
      if (!/\s/.test(normalizedText[originalIndex])) {
        normalizedIndex++
      }
      originalIndex++
    }
    
    return originalIndex
  }
  
  return -1
}

/**
 * 应用编辑
 */
export function applyEdits(
  text: string,
  edits: Array<{ oldString: string; newString: string; replaceAll?: boolean }>
): string {
  let result = text
  
  for (const edit of edits) {
    if (edit.replaceAll) {
      result = result.split(edit.oldString).join(edit.newString)
    } else {
      const index = result.indexOf(edit.oldString)
      if (index !== -1) {
        result = result.slice(0, index) + edit.newString + result.slice(index + edit.oldString.length)
      }
    }
  }
  
  return result
}

/**
 * 生成 diff
 */
export function generateDiff(original: string, modified: string): string {
  const originalLines = original.split("\n")
  const modifiedLines = modified.split("\n")
  
  const diff: string[] = []
  
  for (let i = 0; i < Math.max(originalLines.length, modifiedLines.length); i++) {
    const origLine = originalLines[i]
    const modLine = modifiedLines[i]
    
    if (origLine === modLine) {
      diff.push(`  ${origLine}`)
    } else {
      if (origLine !== undefined) {
        diff.push(`- ${origLine}`)
      }
      if (modLine !== undefined) {
        diff.push(`+ ${modLine}`)
      }
    }
  }
  
  return diff.join("\n")
}

/**
 * 分割 BOM
 */
export function splitBom(content: string): { bom: string; rest: string } {
  if (content.charCodeAt(0) === 0xFEFF) {
    return { bom: content[0], rest: content.slice(1) }
  }
  return { bom: "", rest: content }
}
