// 运行修订链冒烟测试：为 Node 注入最小浏览器环境后，用 esbuild 即时编译 TS。
import { build } from '../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- 最小浏览器环境 ----
function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
      // 模拟跨标签页 storage 事件仅在需要时由测试触发；这里不自动派发。
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}
const localStorage = createMemoryStorage();
const sessionStorage = createMemoryStorage();
globalThis.localStorage = localStorage;
globalThis.sessionStorage = sessionStorage;
globalThis.window = {
  localStorage,
  sessionStorage,
  addEventListener: () => {},
  removeEventListener: () => {},
  clearTimeout: () => 0,
  // 测试中禁用自动保存定时器，由用例显式 flushPersist。
  setTimeout: () => 0,
};

// ---- 编译测试与依赖到临时 ESM ----
const result = await build({
  entryPoints: ['scripts/revision.smoke.test.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
});
const dir = mkdtempSync(join(tmpdir(), 'ff-test-'));
const out = join(dir, 'test.mjs');
writeFileSync(out, result.outputFiles[0].text);

await import(pathToFileURL(out).href);
