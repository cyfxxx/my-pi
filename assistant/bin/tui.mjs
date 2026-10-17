#!/usr/bin/env node
/** 终端前端入口：参数是宿主地址（带 ?token=…）。 */
import { runTui } from '../src/tui.mjs';

const url = process.argv[2];
if (!url) {
  console.error('用法：node bin/tui.mjs "http://127.0.0.1:3099/?token=…"');
  process.exit(2);
}
await runTui(url);
