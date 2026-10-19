/**
 * check-upstreams：快速检查"有明确上游"的组件有没有新版本。
 *
 * 策略（docs/POLICIES.md §3）：运行时/依赖/工具链不进仓库，只记来源；用本脚本一键对账。
 *
 * 用法：
 *   node assistant/scripts/check-upstreams.mjs          # 人读表格
 *   node assistant/scripts/check-upstreams.mjs --json   # 机读
 *
 * 数据来源：npm registry（公开、无需凭据）。GitHub 仓库（如 dsh-TUI）走 npm dist-tags。
 */
const UPSTREAMS = [
  { name: '@deepseek-ai/dsh', role: '宿主运行时（vendor-dsh.sh 安装）', pinned: '0.2.0-rc.2', track: 'next' },
  { name: '@deepseek-harness-tui/dsh-tui', role: '社区 TUI（setup-tui.sh 安装，可选）', pinned: '0.16.1', track: 'latest' },
  { name: '@earendil-works/pi-ai', role: '本地模型层（dsh-llm-pi-ai 依赖）', pinned: null, track: 'latest' },
  { name: '@earendil-works/pi-tui', role: '自带终端前端渲染库', pinned: null, track: 'latest' },
];

async function fetchPackage(name, attempt = 1) {
  // 注意：scope 包直接用 `@scope/name` 拼路径即可；把 @ 编码成 %40 会被 registry 拒（fetch failed）。
  try {
    const response = await fetch(`https://registry.npmjs.org/${name}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      return fetchPackage(name, attempt + 1);
    }
    throw error;
  }
}

const results = [];
for (const item of UPSTREAMS) {
  try {
    const meta = await fetchPackage(item.name);
    const tags = meta['dist-tags'] ?? {};
    results.push({
      name: item.name,
      role: item.role,
      pinned: item.pinned,
      latest: tags.latest ?? null,
      next: tags.next ?? null,
      tracked: tags[item.track] ?? tags.latest ?? null,
    });
  } catch (error) {
    results.push({ name: item.name, role: item.role, pinned: item.pinned, error: String(error) });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  process.exit(0);
}

console.log(`上游检查（${new Date().toISOString().slice(0, 10)}）\n`);
console.log('包名'.padEnd(42) + '当前钉'.padEnd(14) + '跟踪'.padEnd(14) + '最新'.padEnd(14) + '状态');
console.log('-'.repeat(100));
for (const row of results) {
  if (row.error) {
    console.log(`${row.name.padEnd(42)}${(row.pinned ?? '-').padEnd(14)}${'?'.padEnd(14)}${'?'.padEnd(14)}✗ ${row.error}`);
    continue;
  }
  const current = row.pinned ?? row.latest;
  const state = row.pinned === null ? '（未钉）' : row.pinned === row.latest ? '✓ 最新' : `↑ 可升到 ${row.latest}`;
  console.log(
    `${row.name.padEnd(42)}${(row.pinned ?? '-').padEnd(14)}${(row.tracked ?? '-').padEnd(14)}${(row.latest ?? '-').padEnd(14)}${state}`,
  );
}
console.log('\n说明：track=next 的包（如 dsh）在预发布期，latest 稳定后再升；升级步骤见 docs/operations/UPGRADE-0.2.1.md。');
