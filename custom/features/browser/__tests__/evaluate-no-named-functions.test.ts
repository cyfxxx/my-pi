/**
 * 守门：`page.evaluate` 回调内不得有具名函数（2026-10-07）
 *
 * 踩过的坑：tsx/esbuild 的 `keepNames` 会向**具名函数**注入 `__name(f, "f")`，而 Playwright 把回调
 * **原样序列化**到浏览器执行 —— 浏览器里没有 `__name`，于是 `findElement` 抛
 * `ReferenceError: __name is not defined`。匿名函数（作为参数传递的箭头）没有名字可保、不会被注入，
 * 所以只有"赋值给标识符"或 `function 名字(){}` 会中招。
 *
 * **为什么用 AST 而不是正则**：正则分不清 `const f = () => {}`（中招）与 `const f = list.map((x) => x)`
 * （安全），也处理不了 `page.evaluate(({ dx, dy }) => ...)` 里解构的 `{`。这个坑的隐蔽之处在于
 * **本地测试不会红**（browser 的测试刻意不启动浏览器），所以守门必须精确，否则会被人"顺手加个豁免"关掉。
 *
 * 本文件自带**反向自检**：先证明扫描器能抓出坏样本，再断言真实源码干净——否则守门可能只是个空操作。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const DIR = fileURLToPath(new URL('..', import.meta.url));

interface Hit {
  line: number;
  name: string;
}

/** 扫描一份源码里所有 `*.evaluate(...)` 回调内的具名函数（任意嵌套深度） */
function findNamedFunctionsInEvaluate(fileName: string, src: string): Hit[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const scanBody = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      hits.push({ line: lineOf(n), name: n.name.getText(sf) });
    }
    if (ts.isFunctionDeclaration(n) && n.name) {
      hits.push({ line: lineOf(n), name: n.name.text });
    }
    ts.forEachChild(n, scanBody);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === 'evaluate') {
        for (const arg of node.arguments) {
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) scanBody(arg.body);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** 真实源码（排除 __tests__）应全部干净 */
function productionFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => join(DIR, f));
}

describe('守门自检：扫描器确实能抓出坏样本', () => {
  it('具名箭头赋值 → 命中', () => {
    const hits = findNamedFunctionsInEvaluate(
      'bad.ts',
      `page.evaluate((sel: string) => { const walk = (r: Document) => { r.querySelectorAll(sel); }; walk(document); });`,
    );
    expect(hits.length).toBe(1);
    expect(hits[0].name).toBe('walk');
  });

  it('具名函数声明 → 命中（含嵌套深度）', () => {
    const hits = findNamedFunctionsInEvaluate(
      'bad2.ts',
      `page.evaluate(() => { if (x) { function inner() {} inner(); } });`,
    );
    expect(hits.map((h) => h.name)).toContain('inner');
  });

  it('安全写法不误报：作为参数传递的匿名箭头、迭代、普通赋值', () => {
    const ok = `page.evaluate((sel: string) => {
      const items = Array.from(document.querySelectorAll(sel)).map((el) => ({ t: el.tagName }));
      const stack: Document[] = [document];
      while (stack.length) { const root = stack.pop()!; root.querySelectorAll(sel); }
      return items;
    });`;
    expect(findNamedFunctionsInEvaluate('ok.ts', ok)).toEqual([]);
  });

  it('解构参数里的 `{` 不会让扫描错位（这是不用正则的原因）', () => {
    const ok = `page.evaluate(({ dx, dy }: { dx: number; dy: number }) => window.scrollBy(dx, dy), { dx: 1, dy: 2 });`;
    expect(findNamedFunctionsInEvaluate('ok2.ts', ok)).toEqual([]);
  });
});

describe('真实源码干净', () => {
  it('browser 目录下所有 evaluate 回调内都没有具名函数', () => {
    const offenders: string[] = [];
    for (const file of productionFiles()) {
      const src = readFileSync(file, 'utf-8');
      for (const hit of findNamedFunctionsInEvaluate(file, src)) {
        offenders.push(`${file.split('/').pop()}:${hit.line} ${hit.name}`);
      }
    }
    expect(
      offenders,
      `这些 evaluate 回调里的具名函数会在浏览器里抛 __name is not defined（改用迭代或匿名箭头）：${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
