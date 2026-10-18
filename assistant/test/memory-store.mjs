/** 记忆库完整性断言（不需要宿主）：schema 版本、条数、字段、是否被脱敏、环境分布。 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? new URL('../memory/entries.json', import.meta.url).pathname;
const store = JSON.parse(readFileSync(file, 'utf8'));
const entries = store.entries ?? [];
const required = ['id', 'category', 'title', 'content', 'tags', 'confidence', 'source', 'recurrence', 'createdAt', 'updatedAt', 'environments'];
const missing = entries.flatMap((e) => required.filter((k) => e[k] === undefined)).slice(0, 5);
const envs = new Set(entries.flatMap((e) => e.environments ?? []));
const ok = store.version === 2 && entries.length >= 120 && missing.length === 0 && envs.has('all');
console.log(JSON.stringify({ file, version: store.version, entries: entries.length, missingFields: missing, envs: [...envs], ok }));
process.exit(ok ? 0 : 1);
