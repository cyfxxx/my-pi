/**
 * web-terminal/static 回归测试：目录穿越与 MIME。
 *
 * `resolveWithinRoot` 是唯一把外部字符串变成磁盘路径的地方，测试重点是"逃逸"类输入。
 */
import { describe, it, expect } from 'vitest';

import { mimeTypeFor, resolveWithinRoot } from '../static';

const ROOT = '/srv/web';

describe('static: resolveWithinRoot', () => {
  it('把根内路径解析为绝对路径', () => {
    expect(resolveWithinRoot(ROOT, '/app.js')).toBe('/srv/web/app.js');
    expect(resolveWithinRoot(ROOT, '/a/b.css')).toBe('/srv/web/a/b.css');
    expect(resolveWithinRoot(ROOT, '/')).toBe('/srv/web');
    expect(resolveWithinRoot(ROOT, '//double//slash.js')).toBe('/srv/web/double/slash.js');
  });

  it('把绝对路径当作根内相对路径，而不是宿主绝对路径', () => {
    expect(resolveWithinRoot(ROOT, '/etc/passwd')).toBe('/srv/web/etc/passwd');
  });

  it('挡住明文与编码的目录穿越', () => {
    expect(resolveWithinRoot(ROOT, '/../etc/passwd')).toBeUndefined();
    expect(resolveWithinRoot(ROOT, '/..%2f..%2fetc/passwd')).toBeUndefined();
    expect(resolveWithinRoot(ROOT, '/%2e%2e/%2e%2e/etc/passwd')).toBeUndefined();
    expect(resolveWithinRoot(ROOT, '/a/../../outside')).toBeUndefined();
  });

  it('挡住同前缀的兄弟目录（/srv/web-evil 不算在根内）', () => {
    expect(resolveWithinRoot(ROOT, '/../web-evil/x.js')).toBeUndefined();
  });

  it('挡住反斜杠、空字节与解码失败的输入', () => {
    expect(resolveWithinRoot(ROOT, '/..%5C..%5Cwindows')).toBeUndefined();
    expect(resolveWithinRoot(ROOT, '/a%00b')).toBeUndefined();
    expect(resolveWithinRoot(ROOT, '/%E0%A4%A')).toBeUndefined();
  });
});

describe('static: mimeTypeFor', () => {
  it('常见前端类型有正确 MIME，未知回退 octet-stream', () => {
    expect(mimeTypeFor('/x/index.html')).toBe('text/html; charset=utf-8');
    expect(mimeTypeFor('/x/app.js')).toBe('text/javascript; charset=utf-8');
    expect(mimeTypeFor('/x/xterm.css')).toBe('text/css; charset=utf-8');
    expect(mimeTypeFor('/x/a.svg')).toBe('image/svg+xml');
    expect(mimeTypeFor('/x/f.woff2')).toBe('font/woff2');
    expect(mimeTypeFor('/x/UPPER.CSS')).toBe('text/css; charset=utf-8');
    expect(mimeTypeFor('/x/unknown.bin')).toBe('application/octet-stream');
    expect(mimeTypeFor('/x/noext')).toBe('application/octet-stream');
  });
});
