/** 用量统计断言：跑一轮工具调用后，`.run/stats/tool-events.jsonl` 里应有一条成功的工具事件。 */
import { existsSync, readFileSync } from 'node:fs';

const file = process.argv[2] ?? '.run/stats/tool-events.jsonl';
const events = existsSync(file)
  ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : [];
const hasNote = events.some((event) => event.tool === 'mypi_note' && event.ok === true && typeof event.durationMs === 'number');
const ok = hasNote && events.every((event) => typeof event.session === 'string');
console.log(JSON.stringify({ file, events: events.length, hasNote, ok }));
process.exit(ok ? 0 : 1);
