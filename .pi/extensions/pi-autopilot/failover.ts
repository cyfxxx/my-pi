import type { FallbackModel } from './types.ts'
import { readTelemetry, statsByModel } from './telemetry.ts'
import { writeRestartRequest } from './state.ts'
import { readSettings } from './config.ts'

export function currentModelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

// 检查 provider 是否可用（健康检查）
async function checkProviderHealth(provider: string): Promise<boolean> {
  try {
    const settings = readSettings()
    // 从 settings 中获取 provider 的 baseUrl
    // 对于 freellmapi，检查 localhost:3001
    // 对于 local-llama，检查 localhost:8080
    const providerUrls: Record<string, string> = {
      'freellmapi': 'http://localhost:3001/v1/models',
      'local-llama': 'http://localhost:8080/v1/models',
    }
    const url = providerUrls[provider]
    if (!url) return true // 未知 provider 默认可用

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000) // 3秒超时

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Authorization': 'Bearer test' },
    })
    clearTimeout(timeout)

    // 只要能连接上就算可用（即使返回 401 认证错误）
    return response.status < 500
  } catch {
    return false
  }
}

// 选择 failover 目标：跳过当前模型，同 provider 优先，结合历史成功率排序
export async function selectFailover(
  chain: FallbackModel[],
  currentProvider: string,
  currentModel: string,
): Promise<FallbackModel | null> {
  if (!chain.length) return null
  const current = currentModelKey(currentProvider, currentModel)
  const candidates = chain.filter(f => currentModelKey(f.provider, f.model) !== current)
  if (!candidates.length) return null

  // 过滤掉不可用的 provider
  const availableCandidates: FallbackModel[] = []
  for (const f of candidates) {
    if (await checkProviderHealth(f.provider)) {
      availableCandidates.push(f)
    } else {
      console.warn(`[pi-autopilot] failover 目标 ${f.provider} 不可用，跳过`)
    }
  }
  if (!availableCandidates.length) return null

  const telemetry = await readTelemetry()
  const byModel = new Map(statsByModel(telemetry).map(s => [currentModelKey(s.provider, s.model), s]))

  const scored = availableCandidates.map(f => {
    const key = currentModelKey(f.provider, f.model)
    const stats = byModel.get(key)
    const sameProvider = f.provider === currentProvider ? 1 : 0
    // 无遥测时同 provider 优先；有遥测时成功率优先
    const score = stats
      ? stats.successRate * 100 + sameProvider * 10
      : 50 + sameProvider * 30
    return { f, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].f
}

export interface FailoverPlan {
  target: FallbackModel | null
  reason: string
}

export async function planFailover(
  chain: FallbackModel[],
  currentProvider: string,
  currentModel: string,
): Promise<FailoverPlan> {
  if (!chain.length) {
    return { target: null, reason: '未配置 fallbackModels' }
  }
  const target = await selectFailover(chain, currentProvider, currentModel)
  if (!target) {
    return { target: null, reason: 'fallbackModels 中无可用备选（全部为当前模型）' }
  }
  return {
    target,
    reason: `${currentProvider}/${currentModel} → ${target.provider}/${target.model}`,
  }
}

// 执行 failover：写重启请求（目标模型），wrapper 拉起后加载新模型
export async function executeFailover(
  target: FallbackModel,
  reason: string,
  dryRun: boolean,
): Promise<string> {
  if (dryRun) {
    return `[dry-run] 将执行: 切换模型 ${target.provider}/${target.model} 并重启\n原因: ${reason}`
  }

  // 健康检查：确保目标 provider 可用
  if (!(await checkProviderHealth(target.provider))) {
    return `failover 目标 ${target.provider} 不可用，跳过切换`
  }

  writeRestartRequest('set_model', {
    targetProvider: target.provider,
    targetModel: target.model,
    reason: `failover: ${reason}`,
  })
  return `正在切换模型 ${target.provider}/${target.model} 并重启...`
}
