import type {
  DiagramConnector,
  DiagramDocument,
  DiagramGroup,
  DiagramNode,
  DiagramSnapshot,
  EntityKind,
  FieldDef,
  LegacyDiagramDocument,
  MergeConflict,
  PendingMerge,
  Revision,
  RevisionEntity,
  RevisionEntityOp,
  RevisionOp,
} from '../types/diagram';

export function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let idCounter = 0;
export function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${idCounter.toString(36)}`;
}

export function makeAuthorId(): string {
  const key = 'pair-wise-yy-07-author';
  let author = '';
  try {
    author = sessionStorage.getItem(key) ?? '';
    if (!author) {
      author = makeId('tab');
      sessionStorage.setItem(key, author);
    }
  } catch {
    author = makeId('tab');
  }
  return author;
}

const ENTITY_KEYS: EntityKind[] = ['node', 'connector', 'group'];

export function entityKey(kind: EntityKind | 'title', id?: string): string {
  return id ? `${kind}:${id}` : kind;
}

export function entityLabel(kind: EntityKind, entity: RevisionEntity | null): string {
  if (!entity) return '已删除对象';
  if (kind === 'node') {
    const node = entity as DiagramNode;
    return node.text || (node.kind === 'table' ? '未命名表' : '未命名节点');
  }
  if (kind === 'connector') {
    const connector = entity as DiagramConnector;
    return connector.label || `${connector.fromId} → ${connector.toId}`;
  }
  return (entity as DiagramGroup).name || '未命名分组';
}

function indexOf(snapshot: DiagramSnapshot, kind: EntityKind): Map<string, RevisionEntity> {
  if (kind === 'node') return new Map(snapshot.nodes.map((item) => [item.id, item]));
  if (kind === 'connector') return new Map(snapshot.connectors.map((item) => [item.id, item]));
  return new Map(snapshot.groups.map((item) => [item.id, item]));
}

export function findEntity(
  snapshot: DiagramSnapshot,
  kind: EntityKind,
  id: string,
): RevisionEntity | null {
  return indexOf(snapshot, kind).get(id) ?? null;
}

function samePayload(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 比较两个快照，得到对象级修订操作集合。 */
export function diffSnapshots(before: DiagramSnapshot, after: DiagramSnapshot): RevisionOp[] {
  const ops: RevisionOp[] = [];

  ENTITY_KEYS.forEach((kind) => {
    const beforeMap = indexOf(before, kind);
    const afterMap = indexOf(after, kind);
    afterMap.forEach((afterEntity, id) => {
      const beforeEntity = beforeMap.get(id);
      if (!beforeEntity) {
        ops.push({ type: 'add', kind, id, after: clonePlain(afterEntity) });
      } else if (!samePayload(beforeEntity, afterEntity)) {
        ops.push({
          type: 'update',
          kind,
          id,
          before: clonePlain(beforeEntity),
          after: clonePlain(afterEntity),
        });
      }
    });
    beforeMap.forEach((beforeEntity, id) => {
      if (!afterMap.has(id)) {
        ops.push({ type: 'remove', kind, id, before: clonePlain(beforeEntity) });
      }
    });
  });

  if (before.title !== after.title) {
    ops.push({ type: 'set-title', before: before.title, after: after.title });
  }
  return ops;
}

export function applyOps(snapshot: DiagramSnapshot, ops: RevisionOp[]): DiagramSnapshot {
  const next = toSnapshot(snapshot);
  ops.forEach((op) => {
    if (op.type === 'set-title') {
      next.title = op.after;
      return;
    }
    const target = next[`${op.kind}s`] as unknown as RevisionEntity[];
    const index = target.findIndex((item) => item.id === op.id);
    if (op.type === 'remove') {
      if (index >= 0) target.splice(index, 1);
    } else if (op.after) {
      const entity = clonePlain(op.after);
      if (index >= 0) target[index] = entity;
      else target.push(entity);
    }
  });
  return next;
}

function isEntityOp(op: RevisionOp): op is RevisionEntityOp {
  return op.type !== 'set-title';
}

/**
 * 三向合并：以共同基线 base 比较本页 local 与另一页 remote。
 * 仅当两侧修改同一对象时产生冲突；其余变更按操作并入。
 */
export function threeWayMerge(
  base: DiagramSnapshot,
  local: DiagramSnapshot,
  remote: DiagramSnapshot,
  options: { guardOlderRemote?: boolean } = {},
): {
  merged: DiagramSnapshot;
  conflicts: MergeConflict[];
  autoOps: RevisionOp[];
  staleKeys: string[];
} {
  const conflicts: MergeConflict[] = [];
  const autoOps: RevisionOp[] = [];
  const staleKeys: string[] = [];

  ENTITY_KEYS.forEach((kind) => {
    const baseMap = indexOf(base, kind);
    const localMap = indexOf(local, kind);
    const remoteMap = indexOf(remote, kind);
    const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
    ids.forEach((id) => {
      const baseEntity = baseMap.get(id) ?? null;
      const localEntity = localMap.get(id) ?? null;
      const remoteEntity = remoteMap.get(id) ?? null;
      const localChanged = !baseEntity
        ? Boolean(localEntity)
        : !localEntity || !samePayload(baseEntity, localEntity);
      const remoteChanged = !baseEntity
        ? Boolean(remoteEntity)
        : !remoteEntity || !samePayload(baseEntity, remoteEntity);

      if (!remoteChanged) return;
      if (localChanged) {
        // 另一页动了本页也在改的对象：旧预览立即失效。
        staleKeys.push(entityKey(kind, id));
      }

      const olderRemote =
        options.guardOlderRemote &&
        baseEntity &&
        remoteEntity &&
        remoteEntity.rev < baseEntity.rev;

      if (localChanged && (!samePayload(localEntity, remoteEntity) || olderRemote)) {
        conflicts.push({
          kind,
          id,
          label: entityLabel(kind, localEntity ?? remoteEntity),
          base: clonePlain(baseEntity),
          local: clonePlain(localEntity),
          remote: clonePlain(remoteEntity),
          choice: 'local',
        });
      } else if (!localChanged) {
        // 本页未动：直接跟随另一页（add / update / remove）。
        if (remoteEntity) {
          autoOps.push({ type: baseEntity ? 'update' : 'add', kind, id, after: clonePlain(remoteEntity) });
        } else if (baseEntity) {
          autoOps.push({ type: 'remove', kind, id, before: clonePlain(baseEntity) });
        }
      }
    });
  });

  // 标题
  if (base.title !== remote.title) {
    if (base.title !== local.title && local.title !== remote.title) {
      staleKeys.push(entityKey('title'));
      conflicts.push({
        kind: 'title',
        id: 'title',
        label: '文档标题',
        base: null,
        local: null,
        remote: null,
        baseTitle: base.title,
        localTitle: local.title,
        remoteTitle: remote.title,
        choice: 'local',
      });
    } else if (base.title === local.title) {
      autoOps.push({ type: 'set-title', before: base.title, after: remote.title });
    }
  }

  const merged = applyOps(local, autoOps);
  return { merged, conflicts, autoOps, staleKeys };
}

/** 按用户的逐项选择，把冲突版本应用到已自动合并的快照上。 */
export function applyConflictChoices(
  merged: DiagramSnapshot,
  conflicts: MergeConflict[],
  remote: DiagramSnapshot,
): DiagramSnapshot {
  const ops: RevisionOp[] = [];
  conflicts.forEach((conflict) => {
    if (conflict.kind === 'title') {
      const chosen = conflict.choice === 'remote' ? remote.title : merged.title;
      if (merged.title !== chosen) ops.push({ type: 'set-title', before: merged.title, after: chosen });
      return;
    }
    const picked =
      conflict.choice === 'remote'
        ? findEntity(remote, conflict.kind, conflict.id)
        : findEntity(merged, conflict.kind, conflict.id);
    const current = findEntity(merged, conflict.kind, conflict.id);
    if (picked && !samePayload(current, picked)) {
      ops.push({
        type: current ? 'update' : 'add',
        kind: conflict.kind,
        id: conflict.id,
        after: clonePlain(picked),
      });
    } else if (!picked && current) {
      ops.push({ type: 'remove', kind: conflict.kind, id: conflict.id, before: clonePlain(current) });
    }
  });
  return applyOps(merged, ops);
}

/** 给快照中的实体盖上修订号：本次操作涉及的对象 rev = headRev+1，其余不动。 */
export function stampSnapshot(
  snapshot: DiagramSnapshot,
  ops: RevisionOp[],
  rev: number,
): DiagramSnapshot {
  const stamped = toSnapshot(snapshot);
  ops.filter(isEntityOp).forEach((op) => {
    const target = stamped[`${op.kind}s`] as unknown as RevisionEntity[];
    const entity = target.find((item) => item.id === op.id);
    if (entity) entity.rev = rev;
  });
  if (ops.some((op) => op.type === 'set-title')) {
    stamped.titleRev = rev;
  }
  return stamped;
}

/**
 * 给修订操作本身盖印：after 中保留的对象快照必须带提交后的修订号，
 * 否则修订链折叠重放出的基线 rev 会与工作区不一致。
 */
export function stampOps(ops: RevisionOp[], rev: number): RevisionOp[] {
  return ops.map((op): RevisionOp => {
    if (op.type === 'set-title' || !op.after) return op;
    const stampedAfter = { ...clonePlain(op.after), rev } as RevisionEntity;
    return { ...op, after: stampedAfter };
  });
}

/** 合并提交时所有保留下来的对象统一推进到新修订号。 */
export function stampMergeSnapshot(snapshot: DiagramSnapshot, rev: number): DiagramSnapshot {
  const stamped = toSnapshot(snapshot);
  stamped.nodes.forEach((node) => {
    node.rev = rev;
  });
  stamped.connectors.forEach((connector) => {
    connector.rev = rev;
  });
  stamped.groups.forEach((group) => {
    group.rev = rev;
  });
  stamped.titleRev = rev;
  return stamped;
}

export function toSnapshot(document: DiagramSnapshot | DiagramDocument): DiagramSnapshot {
  return {
    docId: document.docId,
    title: document.title,
    titleRev: document.titleRev,
    headRev: document.headRev,
    nodes: clonePlain(document.nodes),
    connectors: clonePlain(document.connectors),
    groups: clonePlain(document.groups),
  };
}

export function snapshotOf(
  docId: string,
  title: string,
  titleRev: number,
  headRev: number,
  nodes: DiagramNode[],
  connectors: DiagramConnector[],
  groups: DiagramGroup[],
): DiagramSnapshot {
  return {
    docId,
    title,
    titleRev,
    headRev,
    nodes: clonePlain(nodes),
    connectors: clonePlain(connectors),
    groups: clonePlain(groups),
  };
}

export function documentFromSnapshot(
  snapshot: DiagramSnapshot,
  revisions: Revision[],
  updatedAt: number,
): DiagramDocument {
  return {
    formatVersion: 2,
    docId: snapshot.docId,
    title: snapshot.title,
    titleRev: snapshot.titleRev,
    headRev: snapshot.headRev,
    nodes: clonePlain(snapshot.nodes),
    connectors: clonePlain(snapshot.connectors),
    groups: clonePlain(snapshot.groups),
    revisions,
    updatedAt,
  };
}

/**
 * 旧稿（v1 整份覆盖格式）升级：
 * 所有对象补稳定身份（字段从字符串提升为对象）与修订号 1，
 * 分组从节点 groupId 中恢复为一等对象，生成一条迁移修订。
 */
export function migrateLegacy(legacy: LegacyDiagramDocument): DiagramDocument {
  const docId = makeId('doc');
  const now = legacy.updatedAt || Date.now();
  const groupNames = new Map<string, string>();
  legacy.nodes.forEach((node, index) => {
    if (node.groupId && !groupNames.has(node.groupId)) {
      groupNames.set(node.groupId, `分组 ${index + 1}`);
    }
  });
  const groups: DiagramGroup[] = [...groupNames.entries()].map(([id, name], index) => ({
    id,
    name,
    color: '#d6e4ff',
    zIndex: index + 1,
    rev: 1,
  }));
  const nodes: DiagramNode[] = legacy.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    text: node.text,
    color: node.color,
    locked: node.locked,
    groupId: node.groupId,
    zIndex: node.zIndex,
    rev: 1,
    fields: node.fields.map((text, index) => ({
      id: makeId(`field-${node.id}-${index}`),
      text,
    })),
  }));
  const connectors: DiagramConnector[] = legacy.connectors.map((connector) => ({
    ...connector,
    rev: 1,
  }));
  const migration: Revision = {
    id: 1,
    parentId: null,
    docId,
    author: 'system',
    source: 'migration',
    label: '从 v1 旧稿升级身份与修订号',
    timestamp: now,
    ops: [
      ...nodes.map((node) => ({ type: 'add' as const, kind: 'node' as const, id: node.id, after: clonePlain(node) })),
      ...connectors.map((connector) => ({
        type: 'add' as const,
        kind: 'connector' as const,
        id: connector.id,
        after: clonePlain(connector),
      })),
      ...groups.map((group) => ({
        type: 'add' as const,
        kind: 'group' as const,
        id: group.id,
        after: clonePlain(group),
      })),
      { type: 'set-title' as const, before: '', after: legacy.title },
    ],
  };
  return {
    formatVersion: 2,
    docId,
    title: legacy.title,
    titleRev: 1,
    headRev: 1,
    nodes,
    connectors,
    groups,
    revisions: [migration],
    updatedAt: now,
  };
}

/** 修复读入的 v2 文档：补齐缺失字段、身份冲突与修订链断裂。 */
export function normalizeDocument(raw: unknown): DiagramDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<DiagramDocument>;
  if (
    candidate.formatVersion !== 2 ||
    typeof candidate.docId !== 'string' ||
    typeof candidate.title !== 'string' ||
    !Array.isArray(candidate.nodes) ||
    !Array.isArray(candidate.connectors) ||
    !Array.isArray(candidate.groups) ||
    !Array.isArray(candidate.revisions)
  ) {
    return null;
  }

  const seenIds = new Set<string>();
  const ensureUnique = (id: unknown, prefix: string): string => {
    let resolved = typeof id === 'string' && id ? id : makeId(prefix);
    if (seenIds.has(resolved)) resolved = makeId(prefix);
    seenIds.add(resolved);
    return resolved;
  };

  const nodeKinds = new Set(['rectangle', 'circle', 'diamond', 'table']);
  const nodes: DiagramNode[] = candidate.nodes
    .filter((node): node is DiagramNode => Boolean(node) && typeof node === 'object')
    .map((node) => {
      const id = ensureUnique(node.id, 'node');
      const fields: FieldDef[] = Array.isArray(node.fields)
        ? node.fields
            .map((field, index) =>
              typeof field === 'string'
                ? { id: makeId(`field-${id}-${index}`), text: field }
                : field && typeof field === 'object' && typeof field.text === 'string'
                  ? { id: ensureUnique(field.id, `field-${id}`), text: field.text }
                  : null,
            )
            .filter((field): field is FieldDef => Boolean(field))
        : [];
      return {
        id,
        kind: nodeKinds.has(node.kind) ? node.kind : 'rectangle',
        x: Number(node.x) || 0,
        y: Number(node.y) || 0,
        width: Number(node.width) || 120,
        height: Number(node.height) || 72,
        text: String(node.text ?? ''),
        color: String(node.color ?? '#ffffff'),
        locked: Boolean(node.locked),
        groupId: typeof node.groupId === 'string' ? node.groupId : null,
        zIndex: Number(node.zIndex) || 0,
        rev: Math.max(0, Math.trunc(Number(node.rev)) || 0),
        fields,
      } satisfies DiagramNode;
    });

  const anchorSides = new Set(['top', 'right', 'bottom', 'left']);
  const connectors: DiagramConnector[] = candidate.connectors
    .filter((item): item is DiagramConnector => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: ensureUnique(item.id, 'connector'),
      fromId: String(item.fromId ?? ''),
      toId: String(item.toId ?? ''),
      fromAnchor: anchorSides.has(item.fromAnchor) ? item.fromAnchor : 'right',
      toAnchor: anchorSides.has(item.toAnchor) ? item.toAnchor : 'left',
      label: String(item.label ?? ''),
      color: String(item.color ?? '#667085'),
      dashed: Boolean(item.dashed),
      locked: Boolean(item.locked),
      zIndex: Number(item.zIndex) || 0,
      rev: Math.max(0, Math.trunc(Number(item.rev)) || 0),
    }));

  const groups: DiagramGroup[] = candidate.groups
    .filter((item): item is DiagramGroup => Boolean(item) && typeof item === 'object')
    .map((item, index) => ({
      id: ensureUnique(item.id, 'group'),
      name: String(item.name ?? `分组 ${index + 1}`),
      color: String(item.color ?? '#d6e4ff'),
      zIndex: Number(item.zIndex) || 0,
      rev: Math.max(0, Math.trunc(Number(item.rev)) || 0),
    }));

  const revisions: Revision[] = candidate.revisions
    .filter((item): item is Revision => Boolean(item) && typeof item === 'object')
    .map((item, index) => ({
      id: Math.max(1, Math.trunc(Number(item.id)) || index + 1),
      parentId: typeof item.parentId === 'number' ? item.parentId : null,
      docId: String(item.docId ?? candidate.docId),
      mergeBaseId: typeof item.mergeBaseId === 'number' ? item.mergeBaseId : null,
      author: String(item.author ?? 'unknown'),
      source: (['bootstrap', 'local', 'merge', 'migration'].includes(item.source)
        ? item.source
        : 'local') as Revision['source'],
      label: String(item.label ?? `修订 ${index + 1}`),
      timestamp: Number(item.timestamp) || Date.now(),
      ops: Array.isArray(item.ops) ? item.ops : [],
    }))
    .sort((a, b) => a.id - b.id);

  const headRev = Math.max(
    1,
    Math.trunc(Number(candidate.headRev)) || revisions.at(-1)?.id || 1,
  );

  return {
    formatVersion: 2,
    docId: candidate.docId,
    title: candidate.title,
    titleRev: Math.max(0, Math.trunc(Number(candidate.titleRev)) || headRev),
    headRev,
    nodes,
    connectors,
    groups,
    revisions,
    updatedAt: Number(candidate.updatedAt) || Date.now(),
  };
}

/** 构建待处理合并（跨标签页或导入），包含冲突与失效对象清单。 */
export function buildPendingMerge(
  base: DiagramSnapshot,
  local: DiagramSnapshot,
  remote: DiagramDocument,
  meta: { source: PendingMerge['source']; sourceLabel: string; sameDoc: boolean; guardOlderRemote?: boolean },
): PendingMerge {
  const remoteSnapshot = toSnapshot(remote);
  const { conflicts, staleKeys, autoOps } = threeWayMerge(base, local, remoteSnapshot, {
    guardOlderRemote: meta.guardOlderRemote,
  });
  return {
    source: meta.source,
    sourceLabel: meta.sourceLabel,
    sameDoc: meta.sameDoc,
    remoteDocId: remote.docId,
    remoteHeadRev: remote.headRev,
    remoteUpdatedAt: remote.updatedAt,
    base,
    remote: remoteSnapshot,
    remoteRevisions: clonePlain(remote.revisions),
    conflicts,
    staleKeys,
    autoChangeCount: autoOps.length,
  };
}

/** 检查导入文件是否为 v1 旧稿。 */
export function isLegacyDocument(raw: unknown): raw is LegacyDiagramDocument {
  if (!raw || typeof raw !== 'object') return false;
  const candidate = raw as Partial<LegacyDiagramDocument>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.connectors)
  );
}
