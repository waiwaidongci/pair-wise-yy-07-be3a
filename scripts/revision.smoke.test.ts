/* eslint-disable no-console */
// 修订链冒烟测试，由 scripts/run-revision-tests.mjs 提供浏览器环境与已激活的 pinia。
import { getActivePinia, setActivePinia, createPinia } from 'pinia';
import { useDiagramStore } from '../src/stores/diagram';
import { loadStableDocument } from '../src/utils/storage';
import { isLegacyDocument, migrateLegacy, normalizeDocument } from '../src/utils/revision';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

if (!getActivePinia()) setActivePinia(createPinia());
const store = useDiagramStore();
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 1. 引导：v2 文档，每个对象带稳定身份和修订号
check('初始画布带稳定身份与 rev=1', () => {
  assert(store.nodes.length === 5, '应有 5 个节点');
  assert(store.connectors.length === 4, '应有 4 条连线');
  assert(store.nodes.every((n) => n.rev === 1 && n.id), '节点 rev=1 且有 id');
  assert(store.nodes[0].fields.every((f) => f.id && f.text), '字段有稳定 id');
  assert(store.headRev === 1, 'headRev=1');
  assert(store.revisions.length === 1, '修订链有 bootstrap');
});

// 2. 本页编辑产生本地修订，保存时只提交本页改动
check('编辑只提升被改对象的 rev', () => {
  const before = store.snapshot();
  assert(before.formatVersion === 2, '导出为 v2');
  store.patchNode('node-fulfill', { text: '进入仓储履约' });
  const fulfill = store.nodes.find((n) => n.id === 'node-fulfill')!;
  assert(fulfill.rev === 2, '被改节点 rev=2');
  const untouched = store.nodes.find((n) => n.id === 'node-close')!;
  assert(untouched.rev === 1, '未改节点 rev 仍为 1');
  assert(store.localSeq === 2, '本地修订序号=2');
  assert(store.hasPendingChanges, '存在未提交改动');
  const result = store.flushPersist();
  assert(result.ok, '保存成功');
  assert(store.headRev === 2, 'headRev=2');
  assert(!store.hasPendingChanges, '提交后无未提交改动');
  const persisted = JSON.parse(localStorage.getItem('pair-wise-yy-07-diagram')!);
  assert(persisted.headRev === 2, '磁盘 headRev=2');
  const rev2 = persisted.revisions.find((r: { id: number }) => r.id === 2);
  const touchedIds = rev2.ops.map((o: { id?: string }) => o.id);
  assert(touchedIds.includes('node-fulfill'), 'r2 含被改节点');
  assert(!touchedIds.includes('node-close'), 'r2 不含未改节点');
  assert(persisted.nodes.find((n: { id: string }) => n.id === 'node-close').rev === 1, '磁盘上未改节点 rev=1');
});

// 3. 撤销 / 重做沿用修订关系（生成新修订，不回退编号）
check('撤销生成反向修订', () => {
  assert(store.canUndo, '可撤销');
  store.undo();
  const node = store.nodes.find((n) => n.id === 'node-fulfill')!;
  assert(node.text === '进入履约流程', '撤销后文字还原');
  assert(node.rev === 3, '撤销产生 rev=3（不回退编号）');
  assert(store.headRev === 2 && store.hasPendingChanges, '基线仍为 r2，撤销待提交');
  store.redo();
  assert(store.nodes.find((n) => n.id === 'node-fulfill')!.text === '进入仓储履约', '重做后文字恢复');
  store.flushPersist();
  assert(store.headRev === 3, '撤销重做链路提交到 r3');
});

check('两个标签页改同一对象：并列两版，确认前不改图', () => {
  const remote = JSON.parse(localStorage.getItem('pair-wise-yy-07-diagram')!);
  const target = remote.nodes.find((n: { id: string }) => n.id === 'node-fulfill');
  target.color = '#ffe4e8';
  target.rev = remote.headRev + 1;
  remote.headRev += 1;
  remote.revisions.push({
    id: remote.headRev,
    parentId: remote.headRev - 1,
    docId: remote.docId,
    author: 'other-tab',
    source: 'local',
    label: '另一标签页改颜色',
    timestamp: Date.now(),
    ops: [{ type: 'update', kind: 'node', id: 'node-fulfill', after: { ...target } }],
  });
  localStorage.setItem('pair-wise-yy-07-diagram', JSON.stringify(remote));

  store.patchNode('node-fulfill', { x: 900 });
  const result = store.flushPersist();
  assert(!result.ok && result.reason === 'conflict', '保存返回冲突');
  assert(store.pendingMerge, '存在待处理合并');
  assert(store.pendingMerge!.conflicts.length === 1, '1 处冲突');
  assert(store.entityStale('node', 'node-fulfill'), '旧预览标记失效');
  assert(store.entityConflict('node', 'node-fulfill'), '冲突标记');
  assert(store.nodes.find((n) => n.id === 'node-fulfill')!.x === 900, '本页坐标保留');
  assert(store.nodes.find((n) => n.id === 'node-fulfill')!.color !== '#ffe4e8', '未采用对方颜色');
  assert(store.headRev === 3, '基线未被推进');

  store.resolveAll('remote');
  const merged = store.nodes.find((n) => n.id === 'node-fulfill')!;
  assert(merged.color === '#ffe4e8', '采用对方颜色');
  assert(store.headRev === 5, `合并后 headRev=5，实际 ${store.headRev}`);
  assert(store.revisions.at(-1)?.source === 'merge', '产生 merge 修订');
  assert(!store.pendingMerge, '冲突已清除');
});

check('不冲突的并行改动自动并入', () => {
  const disk = JSON.parse(localStorage.getItem('pair-wise-yy-07-diagram')!);
  const other = JSON.parse(JSON.stringify(disk));
  const close = other.nodes.find((n: { id: string }) => n.id === 'node-close');
  close.color = '#f0e8ff';
  close.rev = other.headRev + 1;
  other.headRev += 1;
  other.revisions.push({
    id: other.headRev,
    parentId: other.headRev - 1,
    docId: other.docId,
    author: 'other-tab',
    source: 'local',
    label: '另一标签页改 node-close',
    timestamp: Date.now(),
    ops: [{ type: 'update', kind: 'node', id: 'node-close', after: { ...close } }],
  });
  localStorage.setItem('pair-wise-yy-07-diagram', JSON.stringify(other));
  store.patchNode('node-review', { text: '人工复核？' });
  const result = store.flushPersist();
  assert(result.ok, '自动合并成功');
  assert(store.nodes.find((n) => n.id === 'node-close')!.color === '#f0e8ff', '含对方改动');
  assert(store.nodes.find((n) => n.id === 'node-review')!.text === '人工复核？', '含本页改动');
  assert(store.revisions.at(-1)?.source === 'merge', '产生自动合并修订');
});

check('本页无改动时 storage 推进直接快进', () => {
  const disk = JSON.parse(localStorage.getItem('pair-wise-yy-07-diagram')!);
  disk.title = '对方改的标题';
  disk.headRev += 1;
  disk.revisions.push({
    id: disk.headRev,
    parentId: disk.headRev - 1,
    docId: disk.docId,
    author: 'other-tab',
    source: 'local',
    label: '改标题',
    timestamp: Date.now(),
    ops: [{ type: 'set-title', before: store.title, after: '对方改的标题' }],
  });
  localStorage.setItem('pair-wise-yy-07-diagram', JSON.stringify(disk));
  store.flushPersist();
  assert(store.title === '对方改的标题', '标题已快进');
  assert(!store.hasPendingChanges, '快进后干净');
});

check('分组带稳定身份并进入修订链', () => {
  store.selectNode('table-customers');
  store.selectNode('table-orders', true);
  store.groupSelection();
  assert(store.groups.length === 1, '有一个分组');
  assert(store.groups[0].id && store.groups[0].rev > 1, '分组有 id 与新 rev');
  const gId = store.groups[0].id;
  assert(store.nodes.find((n) => n.id === 'table-customers')!.groupId === gId, '节点引用分组');
  store.flushPersist();
  const disk = JSON.parse(localStorage.getItem('pair-wise-yy-07-diagram')!);
  assert(disk.groups.length === 1, '分组已落盘');
});

check('主稿损坏时从最后稳定版本恢复', () => {
  // 自包含构造：稳定备份里放一份带可识别标记的文档，主稿再损坏。
  const savedMain = localStorage.getItem('pair-wise-yy-07-diagram');
  const savedStable = localStorage.getItem('pair-wise-yy-07-diagram:stable');
  const stableDoc = store.snapshot();
  localStorage.setItem('pair-wise-yy-07-diagram:stable', JSON.stringify(stableDoc));
  localStorage.setItem('pair-wise-yy-07-diagram:staging', JSON.stringify(null));
  localStorage.setItem('pair-wise-yy-07-diagram', '{这不是合法JSON');
  const result = loadStableDocument();
  assert(result.document, '从备份恢复出文档');
  assert(result.recoveredFrom === 'stable', `来源=stable，实际 ${result.recoveredFrom}`);
  assert(
    result.document!.nodes.length === stableDoc.nodes.length,
    '恢复的稳定版图元数量一致',
  );
  // 还原真实主稿，避免自愈写入影响后续用例。
  if (savedMain) localStorage.setItem('pair-wise-yy-07-diagram', savedMain);
  if (savedStable !== null) localStorage.setItem('pair-wise-yy-07-diagram:stable', savedStable);
});

check('v1 旧稿打开先升级身份与修订号', () => {
  const legacy = {
    version: 1 as const,
    title: '旧版图表',
    updatedAt: Date.now(),
    nodes: [
      {
        id: 'old-a', kind: 'rectangle' as const, x: 1, y: 2, width: 10, height: 10,
        text: 'A', color: '#fff', locked: false, groupId: 'g-old', zIndex: 1,
        fields: ['f1', 'f2'],
      },
    ],
    connectors: [
      {
        id: 'old-c', fromId: 'old-a', toId: 'old-a', fromAnchor: 'right' as const, toAnchor: 'left' as const,
        label: '', color: '#000', dashed: false, locked: false, zIndex: 1,
      },
    ],
  };
  assert(isLegacyDocument(legacy), '识别为 v1');
  const migrated = migrateLegacy(legacy);
  assert(migrated.formatVersion === 2, '升级为 v2');
  assert(migrated.nodes[0].fields[0].id, '字段升级为带 id 对象');
  assert(migrated.groups[0].id === 'g-old', 'groupId 恢复为一等分组');
  assert(migrated.connectors[0].rev === 1, '连线补 rev');
  assert(migrated.revisions[0].source === 'migration', '有迁移修订');
  assert(normalizeDocument(migrated), '迁移结果可被 v2 校验接受');
});

check('坏文件导入不影响当前画布并触发恢复', () => {
  const nodesBefore = store.nodes.length;
  const result = store.importJson('{bad json', 'bad.json');
  assert(!result.ok, '导入失败');
  assert(store.nodes.length === nodesBefore, '画布不变');
});

check('导入 v1 文件完成迁移合并', () => {
  // 跨文档导入：当前画布干净时直接快进到迁移后的文档。
  const v1 = JSON.stringify({
    version: 1,
    title: '导入的旧稿',
    updatedAt: Date.now(),
    nodes: [
      {
        id: 'imported-a', kind: 'rectangle', x: 10, y: 10, width: 120, height: 60,
        text: '导入节点', color: '#fff', locked: false, groupId: null, zIndex: 1,
        fields: [],
      },
    ],
    connectors: [],
  });
  const result = store.importJson(v1, 'old.json');
  assert(result.ok, 'v1 导入成功');
  // 本页有改动时进入并列两版（确认前不改图）；确认后采用导入文档。
  if (result.pending) {
    assert(store.pendingMerge, '待决合并存在');
    store.resolveAll('remote');
  }
  assert(
    store.nodes.some((n) => n.id === 'imported-a'),
    'v1 节点身份已迁移并入',
  );
});

check('导出 JSON 含修订链且未提交改动临时成修订', () => {
  const targetNode = store.nodes[0];
  assert(targetNode, '画布上至少有一个节点');
  store.patchNode(targetNode.id, { color: '#abcdef' });
  const exported = store.snapshot();
  assert(exported.revisions.length >= store.revisions.length, '导出含修订链');
  assert(exported.headRev >= store.headRev, '导出版 headRev 不低于基线');
  assert(
    exported.nodes.find((n) => n.id === targetNode.id)!.rev === exported.headRev,
    '未提交改动在导出中盖修订号',
  );
  assert(store.headRev < store.localSeq, '当前基线未被导出推进');
  store.flushPersist();
});

check('跨标签页 storage 事件：本页干净时快进，有改动时并列两版', () => {
  // 干净场景
  const disk = JSON.parse(localStorage.getItem('pair-wise-yy-07-diagram')!);
  const ahead = JSON.parse(JSON.stringify(disk));
  const nextHead = ahead.headRev + 1;
  const review = ahead.nodes.find((n: { id: string }) => n.id === 'imported-a');
  review.text = '远程修订文字';
  review.rev = nextHead;
  const beforeReview = disk.nodes.find((n: { id: string }) => n.id === 'imported-a');
  ahead.headRev = nextHead;
  ahead.revisions.push({
    id: nextHead,
    parentId: nextHead - 1,
    docId: ahead.docId,
    author: 'other-tab',
    source: 'local',
    label: '远程改 review',
    timestamp: Date.now(),
    ops: [{ type: 'update', kind: 'node', id: 'imported-a', before: { ...beforeReview }, after: { ...review } }],
  });
  const serialized = JSON.stringify(ahead);
  store.handleStorageEvent({ key: 'pair-wise-yy-07-diagram', newValue: serialized } as StorageEvent);
  assert(store.nodes.find((n) => n.id === 'imported-a')!.text === '远程修订文字', '干净时快进生效');

  // 有本页改动 + 对方改同一对象 → 待决且图不改
  const base2 = JSON.parse(localStorage.getItem('pair-wise-yy-07-diagram')!);
  const ahead2 = JSON.parse(JSON.stringify(base2));
  const nextHead2 = ahead2.headRev + 1;
  const fulfill2 = ahead2.nodes.find((n: { id: string }) => n.id === 'imported-a');
  fulfill2.text = '对方改的履约';
  fulfill2.rev = nextHead2;
  ahead2.headRev = nextHead2;
  ahead2.revisions.push({
    id: nextHead2,
    parentId: nextHead2 - 1,
    docId: ahead2.docId,
    author: 'other-tab',
    source: 'local',
    label: '远程改 fulfill',
    timestamp: Date.now(),
    ops: [{ type: 'update', kind: 'node', id: 'imported-a', after: { ...fulfill2 } }],
  });
  store.patchNode('imported-a', { text: '本页改的履约' });
  store.handleStorageEvent({ key: 'pair-wise-yy-07-diagram', newValue: JSON.stringify(ahead2) } as StorageEvent);
  assert(store.pendingMerge, '出现待决并列两版');
  assert(store.syncState === 'conflict', '状态为 conflict');
  assert(store.nodes.find((n) => n.id === 'imported-a')!.text === '本页改的履约', '当前图保持本页版本');
  store.cancelPendingMerge();
});

console.log(`\n全部 ${passed} 项修订链冒烟测试通过`);
