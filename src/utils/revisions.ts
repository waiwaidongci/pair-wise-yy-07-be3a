import type {
  AnchorSide,
  ConflictItem,
  DiagramConnector,
  DiagramDocument,
  DiagramGroup,
  DiagramNode,
  NodeField,
  NodeKind,
} from '../types/diagram';

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 新建字段，带上稳定身份与当前修订号。 */
export function newField(text: string, rev: number): NodeField {
  return { id: makeId('field'), text, rev };
}

const NODE_KINDS: NodeKind[] = ['rectangle', 'circle', 'diamond', 'table'];
const ANCHOR_SIDES: AnchorSide[] = ['top', 'right', 'bottom', 'left'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidField(value: unknown): value is NodeField {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.rev === 'number'
  );
}

function isValidNode(value: unknown): value is DiagramNode {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.rev === 'number' &&
    NODE_KINDS.includes(value.kind as NodeKind) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.text === 'string' &&
    typeof value.color === 'string' &&
    typeof value.locked === 'boolean' &&
    (value.groupId === null || typeof value.groupId === 'string') &&
    typeof value.zIndex === 'number' &&
    Array.isArray(value.fields) &&
    value.fields.every(isValidField)
  );
}

function isValidConnector(value: unknown): value is DiagramConnector {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.rev === 'number' &&
    typeof value.fromId === 'string' &&
    typeof value.toId === 'string' &&
    ANCHOR_SIDES.includes(value.fromAnchor as AnchorSide) &&
    ANCHOR_SIDES.includes(value.toAnchor as AnchorSide) &&
    typeof value.label === 'string' &&
    typeof value.color === 'string' &&
    typeof value.dashed === 'boolean' &&
    typeof value.locked === 'boolean' &&
    typeof value.zIndex === 'number'
  );
}

function isValidGroup(value: unknown): value is DiagramGroup {
  return isObject(value) && typeof value.id === 'string' && typeof value.rev === 'number' && typeof value.name === 'string';
}

export function isValidDoc(value: unknown): value is DiagramDocument {
  if (!isObject(value)) return false;
  return (
    value.version === 2 &&
    typeof value.docRev === 'number' &&
    typeof value.title === 'string' &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isValidNode) &&
    Array.isArray(value.connectors) &&
    value.connectors.every(isValidConnector) &&
    Array.isArray(value.groups) &&
    value.groups.every(isValidGroup)
  );
}

type MigrateResult = { ok: true; doc: DiagramDocument } | { ok: false; error: string };

/**
 * 旧稿打开先升级身份与修订号：
 * v1 节点补 rev=1，字段字符串升级为带身份的对象，group 补成一等对象，文档升到 v2。
 * v2 严格校验，坏文件直接拒绝，绝不覆盖当前图。
 */
export function migrateDoc(raw: unknown): MigrateResult {
  if (!isObject(raw)) return { ok: false, error: '文件不是有效的 JSON 对象' };
  if (raw.version === 2) {
    return isValidDoc(raw)
      ? { ok: true, doc: clonePlain(raw) }
      : { ok: false, error: 'v2 文件结构不完整或字段类型错误' };
  }
  if (raw.version !== 1) {
    return { ok: false, error: `不支持的文件版本 v${String(raw.version)}` };
  }

  const nodesRaw = Array.isArray(raw.nodes) ? raw.nodes : [];
  const connectorsRaw = Array.isArray(raw.connectors) ? raw.connectors : [];
  const groupsMap = new Map<string, DiagramGroup>();

  const nodes: DiagramNode[] = nodesRaw.filter(isObject).map((entry) => {
    const groupId = typeof entry.groupId === 'string' ? entry.groupId : null;
    if (groupId && !groupsMap.has(groupId)) {
      groupsMap.set(groupId, { id: groupId, rev: 1, name: '分组' });
    }
    const fields: NodeField[] = Array.isArray(entry.fields)
      ? entry.fields
          .map((field) => {
            if (typeof field === 'string') return { id: makeId('field'), text: field, rev: 1 };
            if (isObject(field) && typeof field.text === 'string') {
              return {
                id: typeof field.id === 'string' ? field.id : makeId('field'),
                text: field.text,
                rev: typeof field.rev === 'number' ? field.rev : 1,
              };
            }
            return null;
          })
          .filter((field): field is NodeField => field !== null)
      : [];
    return {
      id: typeof entry.id === 'string' ? entry.id : makeId('node'),
      rev: 1,
      kind: NODE_KINDS.includes(entry.kind as NodeKind) ? (entry.kind as NodeKind) : 'rectangle',
      x: Number(entry.x) || 0,
      y: Number(entry.y) || 0,
      width: Number(entry.width) || 160,
      height: Number(entry.height) || 72,
      text: typeof entry.text === 'string' ? entry.text : '',
      color: typeof entry.color === 'string' ? entry.color : '#ffffff',
      locked: Boolean(entry.locked),
      groupId,
      zIndex: Number(entry.zIndex) || 0,
      fields,
    };
  });

  const connectors: DiagramConnector[] = connectorsRaw
    .filter(isObject)
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : makeId('connector'),
      rev: 1,
      fromId: typeof entry.fromId === 'string' ? entry.fromId : '',
      toId: typeof entry.toId === 'string' ? entry.toId : '',
      fromAnchor: ANCHOR_SIDES.includes(entry.fromAnchor as AnchorSide)
        ? (entry.fromAnchor as AnchorSide)
        : 'right',
      toAnchor: ANCHOR_SIDES.includes(entry.toAnchor as AnchorSide)
        ? (entry.toAnchor as AnchorSide)
        : 'left',
      label: typeof entry.label === 'string' ? entry.label : '',
      color: typeof entry.color === 'string' ? entry.color : '#667085',
      dashed: Boolean(entry.dashed),
      locked: Boolean(entry.locked),
      zIndex: Number(entry.zIndex) || 0,
    }))
    .filter((connector) => connector.fromId && connector.toId);

  const doc: DiagramDocument = {
    version: 2,
    docRev: 1,
    title: typeof raw.title === 'string' ? raw.title : '未命名图表',
    nodes,
    connectors,
    groups: [...groupsMap.values()],
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
  return isValidDoc(doc)
    ? { ok: true, doc }
    : { ok: false, error: '升级后的文件校验失败' };
}

interface MergeOne<T> {
  merged: T[];
  conflicts: Array<{ id: string; base: T | null; local: T | null; remote: T | null }>;
  remoteApplied: number;
}

/** 按稳定身份做三方合并：base=上次稳定版，local=本机，remote=另一标签页。 */
function mergeById<T extends { id: string }>(base: T[], local: T[], remote: T[]): MergeOne<T> {
  const baseMap = new Map(base.map((item) => [item.id, item]));
  const localMap = new Map(local.map((item) => [item.id, item]));
  const remoteMap = new Map(remote.map((item) => [item.id, item]));
  const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
  const merged: T[] = [];
  const conflicts: MergeOne<T>['conflicts'] = [];
  let remoteApplied = 0;

  ids.forEach((id) => {
    const b = baseMap.get(id) ?? null;
    const l = localMap.get(id) ?? null;
    const r = remoteMap.get(id) ?? null;
    if (l && r) {
      if (deepEqual(l, r)) {
        merged.push(l);
        return;
      }
      const lChanged = b ? !deepEqual(l, b) : true;
      const rChanged = b ? !deepEqual(r, b) : true;
      if (lChanged && rChanged) {
        conflicts.push({ id, base: b, local: l, remote: r });
        merged.push(l); // 预览先保留本机，等用户确认
      } else if (lChanged) {
        merged.push(l);
      } else {
        merged.push(r);
        remoteApplied += 1;
      }
    } else if (l && !r) {
      // 远端删除、本机改了 -> 删除/修改冲突；本机没改则接受删除。
      if (b && !deepEqual(l, b)) {
        conflicts.push({ id, base: b, local: l, remote: null });
        merged.push(l);
      } else if (!b) {
        merged.push(l); // 本机新建、远端从未有过
      }
    } else if (!l && r) {
      // 本机删除、远端改了 -> 删除/修改冲突；远端新建则接受。
      if (b && !deepEqual(r, b)) {
        conflicts.push({ id, base: b, local: null, remote: r });
      } else if (!b) {
        merged.push(r);
        remoteApplied += 1;
      }
    }
  });

  return { merged, conflicts, remoteApplied };
}

export interface MergeResult {
  preview: DiagramDocument;
  items: ConflictItem[];
  autoMerged: number;
}

function nodeLabel(node: DiagramNode | null): string {
  if (!node) return '已删除节点';
  return node.text?.trim() || `${node.kind} 节点`;
}

function connectorLabel(connector: DiagramConnector | null): string {
  if (!connector) return '已删除连线';
  return connector.label?.trim() || '未命名连线';
}

/** 合并远端文档；冲突项进 items（不改当前图），其余并入 preview。 */
export function mergeDoc(
  base: DiagramDocument,
  local: DiagramDocument,
  remote: DiagramDocument,
): MergeResult {
  const nodes = mergeById(base.nodes, local.nodes, remote.nodes);
  const connectors = mergeById(base.connectors, local.connectors, remote.connectors);
  const groups = mergeById(base.groups, local.groups, remote.groups);

  // 分组成员以 node.groupId 为准；组合并后清掉指向已删除分组的引用。
  const groupIds = new Set(groups.merged.map((group) => group.id));
  const mergedNodes = nodes.merged.map((node) =>
    node.groupId && !groupIds.has(node.groupId) ? { ...node, groupId: null } : node,
  );

  const localTitleChanged = !deepEqual(local.title, base.title);
  const remoteTitleChanged = !deepEqual(remote.title, base.title);
  const titleConflict =
    localTitleChanged && remoteTitleChanged && !deepEqual(local.title, remote.title);

  const preview: DiagramDocument = {
    version: 2,
    docRev: Math.max(local.docRev, remote.docRev),
    title: titleConflict ? local.title : localTitleChanged ? local.title : remote.title,
    nodes: mergedNodes,
    connectors: connectors.merged,
    groups: groups.merged,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };

  const items: ConflictItem[] = [
    ...nodes.conflicts.map((conflict) => ({
      kind: 'node' as const,
      id: conflict.id,
      label: nodeLabel(conflict.local as DiagramNode | null),
      base: conflict.base,
      local: conflict.local,
      remote: conflict.remote,
      choice: 'local' as const,
    })),
    ...connectors.conflicts.map((conflict) => ({
      kind: 'connector' as const,
      id: conflict.id,
      label: connectorLabel(conflict.local as DiagramConnector | null),
      base: conflict.base,
      local: conflict.local,
      remote: conflict.remote,
      choice: 'local' as const,
    })),
    ...groups.conflicts.map((conflict) => ({
      kind: 'group' as const,
      id: conflict.id,
      label: (conflict.local as DiagramGroup | null)?.name ?? '已删除分组',
      base: conflict.base,
      local: conflict.local,
      remote: conflict.remote,
      choice: 'local' as const,
    })),
  ];
  if (titleConflict) {
    items.push({
      kind: 'title',
      id: '__title__',
      label: '图表标题',
      base: base.title,
      local: local.title,
      remote: remote.title,
      choice: 'local',
    });
  }

  return {
    preview,
    items,
    autoMerged: nodes.remoteApplied + connectors.remoteApplied + groups.remoteApplied,
  };
}

/** 按用户在并列两版中做的选择，把冲突项落到 preview 上。 */
export function finalizeMerge(
  preview: DiagramDocument,
  remote: DiagramDocument,
  items: ConflictItem[],
): DiagramDocument {
  const doc = clonePlain(preview);
  items.forEach((item) => {
    if (item.choice !== 'remote') return;
    if (item.kind === 'title') {
      doc.title = item.remote as string;
      return;
    }
    const list =
      item.kind === 'node' ? doc.nodes : item.kind === 'connector' ? doc.connectors : doc.groups;
    const index = list.findIndex((object) => object.id === item.id);
    if (item.remote === null) {
      if (index >= 0) list.splice(index, 1); // 采用远端的删除
    } else if (index >= 0) {
      list[index] = item.remote as never;
    } else {
      list.push(item.remote as never);
    }
  });

  const groupIds = new Set(doc.groups.map((group) => group.id));
  doc.nodes = doc.nodes.map((node) =>
    node.groupId && !groupIds.has(node.groupId) ? { ...node, groupId: null } : node,
  );
  doc.docRev = Math.max(doc.docRev, remote.docRev);
  doc.updatedAt = Date.now();
  return doc;
}

export interface FieldDiff {
  field: string;
  label: string;
  local: string;
  remote: string;
}

const NODE_FIELD_LABELS: Record<string, string> = {
  text: '文本',
  x: 'X 坐标',
  y: 'Y 坐标',
  width: '宽度',
  height: '高度',
  color: '颜色',
  locked: '锁定',
  groupId: '分组',
  zIndex: '层级',
};

const CONNECTOR_FIELD_LABELS: Record<string, string> = {
  label: '标签',
  color: '颜色',
  dashed: '虚线',
  fromAnchor: '起点锚点',
  toAnchor: '终点锚点',
  locked: '锁定',
  zIndex: '层级',
};

const GROUP_FIELD_LABELS: Record<string, string> = { name: '名称' };

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (field === 'locked' || field === 'dashed') return value ? '是' : '否';
  if (field === 'groupId') return value ? '已分组' : '无';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** 并列两版时，逐字段列出本机与远端的差异。 */
export function diffItem(item: ConflictItem): FieldDiff[] {
  if (item.kind === 'title') {
    return [{ field: 'title', label: '标题', local: String(item.local), remote: String(item.remote) }];
  }
  const labels =
    item.kind === 'node'
      ? NODE_FIELD_LABELS
      : item.kind === 'connector'
        ? CONNECTOR_FIELD_LABELS
        : GROUP_FIELD_LABELS;
  const local = (item.local ?? {}) as Record<string, unknown>;
  const remote = (item.remote ?? {}) as Record<string, unknown>;
  const fields = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const diffs: FieldDiff[] = [];
  fields.forEach((field) => {
    if (!(field in labels)) return;
    const localValue = local[field];
    const remoteValue = remote[field];
    if (deepEqual(localValue, remoteValue)) return;
    diffs.push({
      field,
      label: labels[field],
      local: formatValue(field, localValue),
      remote: formatValue(field, remoteValue),
    });
  });
  if (item.kind === 'node') {
    const localFields = JSON.stringify(
      (local as unknown as DiagramNode).fields?.map((field) => field.text) ?? [],
    );
    const remoteFields = JSON.stringify(
      (remote as unknown as DiagramNode).fields?.map((field) => field.text) ?? [],
    );
    if (localFields !== remoteFields) {
      diffs.push({ field: 'fields', label: '字段', local: localFields, remote: remoteFields });
    }
  }
  return diffs;
}
