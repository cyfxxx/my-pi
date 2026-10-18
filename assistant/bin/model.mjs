#!/usr/bin/env node
/**
 * 切换默认模型路由：node bin/model.mjs online|local
 *
 * 注意（实测行为）：`session/selectModel` 会把选择**同时写回** profile 的默认模型
 * （`<home>/profiles/<name>/cordis.patch.yml` 的 `agent-default-model`），所以这条命令
 * 等于"把默认模型也换了"。这正是我们要的效果，但不是"只改当前会话"。
 */
import { HostClient } from '../src/transport.mjs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAUNCHER = join(dirname(fileURLToPath(import.meta.url)), '..', 'host', 'launch.mjs');

const route = process.argv[2];
const online = {
  provider: process.env.MYPI_ONLINE_PROVIDER ?? 'deepseek-official',
  model: process.env.MYPI_ONLINE_MODEL ?? 'deepseek-flash',
};
const local = {
  provider: process.env.MYPI_LOCAL_PROVIDER ?? 'local',
  model: process.env.MYPI_LOCAL_MODEL ?? 'mock-local',
};
const target = { online, local }[route];
if (target === undefined) {
  console.error('用法：node bin/model.mjs online|local');
  process.exit(2);
}

const url = execFileSync(process.execPath, [LAUNCHER, 'url'], { encoding: 'utf8' }).trim();
const client = await new HostClient({ url }).connect();
const created = await client.call('session/create', { request: { cwd: process.cwd() } });
const sessionId = created.value.sessionId;
const result = await client.call('session/selectModel', {
  request: { sessionId, provider: target.provider, model: target.model },
});
console.log(JSON.stringify({ ok: true, defaultModel: target, result: result.value }, null, 0));
process.exit(0);
