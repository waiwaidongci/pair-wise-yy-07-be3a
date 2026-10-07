import { defineStore } from 'pinia';
import type {
  DiagramConnector,
  DiagramDocument,
  DiagramGroup,
  DiagramNode,
  DiagramSnapshot,
  EntityKind,
  FieldDef,
  MergeConflict,
  NodeKind,
  PendingMerge,
  Revision,
  RevisionEntity,
  RevisionOp,
  RevisionSource,
  ToolMode,
} from '../types/diagram';
import { DEFAULT_NODE_SIZE } from '../utils/diagramGeometry';
import {
  applyConflictChoices,
  applyOps,
  buildPendingMerge,
  clonePlain,
  diffSnapshots,
  documentFromSnapshot,
  entityKey,
  isLegacyDocument,
  makeAuthorId,
  makeId,
  migrateLegacy,
  normalizeDocument,
  snapshotOf,
  stampOps,
  stampSnapshot,
  threeWayMerge,
  toSnapshot,
} from '../utils/revision';
import { loadStableDocument, STORAGE_KEY, writeDocumentCrashSafe } from '../utils/storage';

const HISTORY_LIMIT = 80;
const REVISION_LIMIT = 500;
let persistTimer: number | undefined;
const tabAuthor = makeAuthorId();

export type SyncState =
  | 'synced'
  | 'ahead'
  | 'remote-ahead'
  | 'conflict'
  | 'recovered-stable'
  | 'recovered-staging';

interface HistoryEntry {
  revision: Revision;
}

function initialFields(lines: string[]): FieldDef[] {
  return lines.map((text) => ({ id: makeId('field'), text }));
}

function initialNodes(): DiagramNode[] {
  return [
    {
      id: 'table-customers',
      kind: 'table',
      x: 90,
      y: 110,
      width: 210,
      height: 170,
      text: 'customers',
      color: '#ffffff',
      locked: false,
      groupId: null,
      zIndex: 1,
      rev: 1,
      fields: initialFields(['id  BIGINT PK', 'name  VARCHAR(80)', 'region  VARCHAR(20)', 'credit_limit DECIMAL']),
    },
    {
      id: 'table-orders',
      kind: 'table',
      x: 470,
      y: 90,
      width: 220,
      height: 190,
      text: 'orders',
      color: '#ffffff',
      locked: false,
      groupId: null,
      zIndex: 2,
      rev: 1,
      fields: initialFields(['id  BIGINT PK', 'customer_id  BIGINT FK', 'amount  DECIMAL', 'status VARCHAR(20)']),
    },
    {
      id: 'node-review',
      kind: 'diamond',
      x: 470,
      y: 370,
      width: 180,
      height: 120,
      text: '风控审核通过？',
      color: '#fff7e8',
      locked: false,
      groupId: null,
      zIndex: 3,
      rev: 1,
      fields: [],
    },
    {
      id: 'node-fulfill',
      kind: 'rectangle',
      x: 820,
      y: 385,
      width: 180,
      height: 76,
      text: '进入履约流程',
      color: '#eaf7f0',
      locked: false,
      groupId: null,
      zIndex: 4,
      rev: 1,
      fields: [],
    },
    {
      id: 'node-close',
      kind: 'circle',
      x: 845,
      y: 130,
      width: 112,
      height: 112,
      text: '订单完成',
      color: '#eef4ff',
      locked: false,
      groupId: null,
      zIndex: 5,
      rev: 1,
      fields: [],
    },
  ];
}

function initialConnectors(): DiagramConnector[] {
  return [
    {
      id: 'connector-customer-orders',
      fromId: 'table-customers',
      toId: 'table-orders',
      fromAnchor: 'right',
      toAnchor: 'left',
      label: '1 : N',
      color: '#1f6feb',
      dashed: false,
      locked: false,
      zIndex: 1,
      rev: 1,
    },
    {
      id: 'connector-orders-review',
      fromId: 'table-orders',
      toId: 'node-review',
      fromAnchor: 'bottom',
      toAnchor: 'top',
      label: '校验',
      color: '#667085',
      dashed: false,
      locked: false,
      zIndex: 2,
      rev: 1,
    },
    {
      id: 'connector-review-fulfill',
      fromId: 'node-review',
      toId: 'node-fulfill',
      fromAnchor: 'right',
      toAnchor: 'left',
      label: '是',
      color: '#12805c',
      dashed: false,
      locked: false,
      zIndex: 3,
      rev: 1,
    },
    {
      id: 'connector-review-close',
      fromId: 'node-review',
      toId: 'node-close',
      fromAnchor: 'top',
      toAnchor: 'bottom',
      label: '驳回',
      color: '#c2413b',
      dashed: true,
      locked: false,
      zIndex: 4,
      rev: 1,
    },
  ];
}

function bootstrapDocument(): DiagramDocument {
  const nodes = initialNodes();
  const connectors = initialConnectors();
  const groups: DiagramGroup[] = [];
  const docId = makeId('doc');
  const now = Date.now();
  const bootstrap: Revision = {
    id: 1,
    parentId: null,
    docId,
    author: 'system',
    source: 'bootstrap',
    label: '初始画布',
    timestamp: now,
    ops: [
      ...nodes.map((node) => ({ type: 'add' as const, kind: 'node' as const, id: node.id, after: clonePlain(node) })),
      ...connectors.map((connector) => ({
        type: 'add' as const,
        kind: 'connector' as const,
        id: connector.id,
        after: clonePlain(connector),
      })),
      { type: 'set-title' as const, before: '', after: '订单履约架构图' },
    ],
  };
  return {
    formatVersion: 2,
    docId,
    title: '订单履约架构图',
    titleRev: 1,
    headRev: 1,
    nodes,
    connectors,
    groups,
    revisions: [bootstrap],
    updatedAt: now,
  };
}

/**
 * 启动加载：主稿损坏时由存储层从稳定备份/暂存区恢复；
 * 若本机只存在 v1 整份覆盖旧稿，先升级身份与修订号再落盘。
 */
function loadInitialDocument(): { document: DiagramDocument; syncState: SyncState; message: string } {
  let legacyRaw: string | null = null;
  try {
    legacyRaw = localStorage.getItem(STORAGE_KEY);
  } catch {
    legacyRaw = null;
  }
  if (legacyRaw) {
    try {
      const parsed: unknown = JSON.parse(legacyRaw);
      if (isLegacyDocument(parsed)) {
        const migrated = migrateLegacy(parsed);
        try {
          writeDocumentCrashSafe(migrated);
          return { document: migrated, syncState: 'synced', message: '旧稿已升级为修订链格式（v2）' };
        } catch {
          return { document: migrated, syncState: 'synced', message: '旧稿已在内存中升级，本机写入不可用' };
        }
      }
    } catch {
      // 落到稳定版本恢复流程。
    }
  }

  const loaded = loadStableDocument();
  if (loaded.document) {
    return {
      document: loaded.document,
      syncState: loaded.recoveredFrom === 'staging' ? 'recovered-staging' : loaded.recoveredFrom === 'stable' ? 'recovered-stable' : 'synced',
      message: loaded.selfHealed ? '主稿不可用，已从最后稳定版本恢复' : '',
    };
  }
  return { document: bootstrapDocument(), syncState: 'synced', message: '' };
}

const initial = loadInitialDocument();
const bootDocument = initial.document;

export const useDiagramStore = defineStore('diagram', {
  state: () => ({
    docId: bootDocument.docId,
    title: bootDocument.title,
    titleRev: bootDocument.titleRev,
    headRev: bootDocument.headRev,
    nodes: bootDocument.nodes,
    connectors: bootDocument.connectors,
    groups: bootDocument.groups,
    revisions: bootDocument.revisions as Revision[],
    selectedIds: [] as string[],
    selectedConnectorId: null as string | null,
    activeNodeId: null as string | null,
    toolMode: 'select' as ToolMode,
    zoom: 1,
    pan: { x: 36, y: 24 },
    snapToGrid: true,
    gridSize: 20,
    historyPast: [] as HistoryEntry[],
    historyFuture: [] as HistoryEntry[],
    /** 本页自最后一次提交后的本地修订序号（> headRev 即存在未提交改动）。 */
    localSeq: bootDocument.headRev,
    author: tabAuthor,
    syncState: initial.syncState as SyncState,
    syncMessage: initial.message,
    lastWrittenRaw: '' as string,
    /** 另一页修改了本页也在改的对象：并列两版前的失效标记。 */
    staleKeys: [] as string[],
    conflictKeys: [] as string[],
    pendingMerge: null as PendingMerge | null,
  }),
  getters: {
    selectedNodes(state): DiagramNode[] {
      return state.nodes.filter((node) => state.selectedIds.includes(node.id));
    },
    activeNode(state): DiagramNode | null {
      return state.nodes.find((node) => node.id === state.activeNodeId) ?? null;
    },
    canUndo: (state) => state.historyPast.length > 0,
    canRedo: (state) => state.historyFuture.length > 0,
    hasPendingChanges: (state) => state.localSeq > state.headRev,
  },
  actions: {
    // --------------------------------------------------------------- 快照
    workingSnapshot(): DiagramSnapshot {
      return snapshotOf(
        this.docId,
        this.title,
        this.titleRev,
        this.headRev,
        this.nodes,
        this.connectors,
        this.groups,
      );
    },
    /**
     * 重建 headRev 处的稳定基线。
     * 修订链上每条修订只记录该次提交的净差异（合并修订尤其如此），
     * 因此不能从 r1 逐条 apply；改为折叠链上每个对象在 headRev 时的最终状态。
     */
    replayBase(): DiagramSnapshot {
      const first = this.revisions[0];
      const empty = snapshotOf(this.docId, '', 0, 0, [], [], []);
      if (!first) {
        return snapshotOf(this.docId, this.title, this.titleRev, this.headRev, this.nodes, this.connectors, this.groups);
      }
      const nodes = new Map<string, DiagramNode>();
      const connectors = new Map<string, DiagramConnector>();
      const groups = new Map<string, DiagramGroup>();
      let title = '';
      let titleRev = 0;
      const tables = {
        node: nodes,
        connector: connectors,
        group: groups,
      } as const;
      this.revisions.forEach((revision) => {
        if (revision.id > this.headRev) return;
        revision.ops.forEach((op) => {
          if (op.type === 'set-title') {
            title = op.after;
            titleRev = revision.id;
            return;
          }
          const table = tables[op.kind] as Map<string, RevisionEntity>;
          if (op.type === 'remove') {
            table.delete(op.id);
          } else if (op.after) {
            table.set(op.id, clonePlain(op.after) as RevisionEntity);
          }
        });
      });
      const snapshot: DiagramSnapshot = {
        ...empty,
        title,
        titleRev,
        headRev: this.headRev,
        docId: this.docId,
        nodes: [...nodes.values()],
        connectors: [...connectors.values()],
        groups: [...groups.values()],
      };
      return snapshot;
    },
    /**
     * 导出用完整 v2 文档：沿用当前修订关系；未提交改动临时补一条本地修订，
     * 不改变当前图与本页修订序号。
     */
    snapshot(includeUncommitted = true): DiagramDocument {
      const base = this.replayBase();
      const working = this.workingSnapshot();
      const ops = diffSnapshots(base, working);
      const chain = clonePlain(this.revisions).slice(-REVISION_LIMIT);
      if (includeUncommitted && ops.length) {
        const newRev = this.headRev + 1;
        const stampedOps = stampOps(ops, newRev);
        chain.push({
          id: newRev,
          parentId: this.headRev,
          docId: this.docId,
          author: this.author,
          source: 'local',
          label: '导出时的未提交改动',
          timestamp: Date.now(),
          ops: clonePlain(stampedOps),
        });
        const stamped = stampSnapshot(working, stampedOps, newRev);
        stamped.headRev = newRev;
        return documentFromSnapshot(stamped, chain, Date.now());
      }
      return documentFromSnapshot({ ...base }, chain, Date.now());
    },
    entityStale(kind: EntityKind | 'title', id?: string): boolean {
      return this.staleKeys.includes(entityKey(kind, id));
    },
    entityConflict(kind: EntityKind | 'title', id?: string): boolean {
      return this.conflictKeys.includes(entityKey(kind, id));
    },

    // ------------------------------------------------------------- 变更入口
    /**
     * 执行一次本页变更：比对前后生成对象级操作集，盖本地修订号并入撤销栈。
     * 保存时只提交这些操作，未改动对象不会出现在提交里。
     */
    recordMutation(label: string, mutate: () => void, source: RevisionSource = 'local'): boolean {
      const before = this.workingSnapshot();
      mutate();
      const after = this.workingSnapshot();
      const ops = diffSnapshots(before, after);
      if (!ops.length) return false;
      const revId = this.localSeq + 1;
      this.localSeq = revId;
      const stampedOps = stampOps(ops, revId);
      this.assignSnapshot(stampSnapshot(after, stampedOps, revId));
      const revision: Revision = {
        id: revId,
        parentId: revId - 1,
        docId: this.docId,
        author: this.author,
        source,
        label,
        timestamp: Date.now(),
        ops: clonePlain(stampedOps),
      };
      this.historyPast.push({ revision });
      if (this.historyPast.length > HISTORY_LIMIT) this.historyPast.shift();
      this.historyFuture = [];
      this.markAhead();
      return true;
    },
    assignSnapshot(snapshot: DiagramSnapshot) {
      this.title = snapshot.title;
      this.titleRev = snapshot.titleRev;
      this.nodes = clonePlain(snapshot.nodes);
      this.connectors = clonePlain(snapshot.connectors);
      this.groups = clonePlain(snapshot.groups);
      this.selectedIds = this.selectedIds.filter((id) => this.nodes.some((node) => node.id === id));
      this.selectedConnectorId = this.connectors.some((item) => item.id === this.selectedConnectorId)
        ? this.selectedConnectorId
        : null;
      this.activeNodeId = this.selectedIds.at(-1) ?? null;
    },
    inverseOps(ops: RevisionOp[]): RevisionOp[] {
      return [...ops].reverse().map((op): RevisionOp => {
        if (op.type === 'set-title') {
          return { type: 'set-title', before: op.after, after: op.before };
        }
        if (op.type === 'add') {
          return { type: 'remove', kind: op.kind, id: op.id, before: clonePlain(op.after) };
        }
        if (op.type === 'remove') {
          return { type: 'add', kind: op.kind, id: op.id, after: clonePlain(op.before) };
        }
        return {
          type: 'update',
          kind: op.kind,
          id: op.id,
          before: clonePlain(op.after),
          after: clonePlain(op.before),
        };
      });
    },
    /** 撤销沿用当前修订关系：不回退修订号，而是生成一条新的反向修订。 */
    undo() {
      const entry = this.historyPast.pop();
      if (!entry) return;
      const inverseRaw = this.inverseOps(entry.revision.ops);
      const before = this.workingSnapshot();
      const reverted = applyOps(before, inverseRaw);
      const inverseDiff = diffSnapshots(before, reverted);
      const revId = this.localSeq + 1;
      this.localSeq = revId;
      // 被还原对象的内容虽回到旧版，但要挂到新修订号上：操作与快照同步盖印。
      const inverseOps = stampOps(inverseRaw, revId);
      const stamped = stampSnapshot(reverted, inverseOps, revId);
      const revertRevision: Revision = {
        id: revId,
        parentId: revId - 1,
        docId: this.docId,
        author: this.author,
        source: 'local',
        label: `撤销：${entry.revision.label}`,
        timestamp: Date.now(),
        ops: clonePlain(inverseOps),
      };
      this.historyFuture.push({ revision: revertRevision });
      this.assignSnapshot(stamped);
      this.markAhead();
      this.persistSoon();
    },
    /** 重做：future 中存的是撤销时生成的反向修订，重做即再取其逆、正向应用并盖新号。 */
    redo() {
      const entry = this.historyFuture.pop();
      if (!entry) return;
      const forwardRaw = this.inverseOps(entry.revision.ops);
      const before = this.workingSnapshot();
      const redone = applyOps(before, forwardRaw);
      const forwardDiff = diffSnapshots(before, redone);
      const revId = this.localSeq + 1;
      this.localSeq = revId;
      const forwardOps = stampOps(forwardRaw, revId);
      const stamped = stampSnapshot(redone, forwardOps, revId);
      const redoRevision: Revision = {
        id: revId,
        parentId: revId - 1,
        docId: this.docId,
        author: this.author,
        source: 'local',
        label: entry.revision.label.replace('撤销：', '重做：'),
        timestamp: Date.now(),
        ops: clonePlain(forwardOps),
      };
      this.historyPast.push({ revision: redoRevision });
      this.assignSnapshot(stamped);
      this.markAhead();
      this.persistSoon();
    },

    // --------------------------------------------------------------- 图元操作
    addNode(kind: NodeKind, position?: { x: number; y: number }) {
      const size = DEFAULT_NODE_SIZE[kind];
      const point = position ?? {
        x: 220 + (this.nodes.length % 4) * 26,
        y: 220 + (this.nodes.length % 3) * 24,

      };
      const node: DiagramNode = {
        id: makeId(kind),
        kind,
        x: this.snapToGrid ? Math.round(point.x / this.gridSize) * this.gridSize : point.x,
        y: this.snapToGrid ? Math.round(point.y / this.gridSize) * this.gridSize : point.y,
        width: size.width,
        height: kind === 'table' ? Math.max(size.height, 82 + 4 * 34) : size.height,
        text:
          kind === 'table'
            ? 'new_table'
            : kind === 'diamond'
              ? '条件判断'
              : kind === 'circle'
                ? '开始 / 结束'
                : '流程节点',
        color: kind === 'table' ? '#ffffff' : '#eef4ff',
        locked: false,
        groupId: null,
        zIndex: Math.max(0, ...this.nodes.map((item) => item.zIndex)) + 1,
        fields: kind === 'table'
          ? [{ id: makeId('field'), text: 'id  BIGINT PK' }, { id: makeId('field'), text: 'name  VARCHAR(80)' }]
          : [],
        rev: 0,
      };
      this.recordMutation(`添加${this.kindLabel(kind)}`, () => {
        this.nodes.push(node);
      });
      this.selectNode(node.id);
      this.persistSoon();
    },
    kindLabel(kind: NodeKind): string {
      return { rectangle: '流程节点', circle: '起止节点', diamond: '判断节点', table: '数据表' }[kind];
    },
    patchNode(id: string, patch: Partial<DiagramNode>) {
      this.recordMutation('更新图元属性', () => {
        const node = this.nodes.find((item) => item.id === id);
        if (node) Object.assign(node, patch);
      });
      this.persistSoon();
    },
    /** 拖拽 / 方向键提交位移，一次交互一条修订。 */
    commitPositions(
      positions: Record<string, { x: number; y: number }>,
      options: { label?: string } = {},
    ) {
      const changed = this.recordMutation(options.label ?? '移动图元', () => {
        Object.entries(positions).forEach(([id, point]) => {
          const node = this.nodes.find((item) => item.id === id);
          if (node) {
            node.x = point.x;
            node.y = point.y;
          }
        });
      });
      if (changed) this.persistSoon();
    },
    selectNode(id: string, append = false) {
      this.selectedConnectorId = null;
      if (append) {
        this.selectedIds = this.selectedIds.includes(id)
          ? this.selectedIds.filter((item) => item !== id)
          : [...this.selectedIds, id];
      } else {
        this.selectedIds = [id];
      }
      this.activeNodeId = id;
    },
    selectConnector(id: string) {
      this.selectedConnectorId = id;
      this.selectedIds = [];
      this.activeNodeId = null;
    },
    clearSelection() {
      this.selectedIds = [];
      this.selectedConnectorId = null;
      this.activeNodeId = null;
    },
    addConnector(
      fromId: string,
      toId: string,
      fromAnchor: DiagramConnector['fromAnchor'],
      toAnchor: DiagramConnector['toAnchor'],
    ) {
      if (fromId === toId) return;
      const exists = this.connectors.some(
        (connector) =>
          connector.fromId === fromId &&
          connector.toId === toId &&
          connector.fromAnchor === fromAnchor &&
          connector.toAnchor === toAnchor,
      );
      if (exists) return;
      const connector: DiagramConnector = {
        id: makeId('connector'),
        fromId,
        toId,
        fromAnchor,
        toAnchor,
        label: '',
        color: '#667085',
        dashed: false,
        locked: false,
        zIndex: Math.max(0, ...this.connectors.map((item) => item.zIndex)) + 1,
        rev: 0,
      };
      this.recordMutation('添加连接线', () => {
        this.connectors.push(connector);
      });
      this.persistSoon();
    },
    patchConnector(id: string, patch: Partial<DiagramConnector>) {
      this.recordMutation('更新连接线', () => {
        const connector = this.connectors.find((item) => item.id === id);
        if (connector) Object.assign(connector, patch);
      });
      this.persistSoon();
    },
    deleteSelection() {
      if (!this.selectedIds.length && !this.selectedConnectorId) return;
      const selected = new Set(this.selectedIds);
      const connectorId = this.selectedConnectorId;
      this.recordMutation('删除所选对象', () => {
        this.nodes = this.nodes.filter((node) => !selected.has(node.id));
        this.connectors = this.connectors.filter(
          (connector) =>
            connector.id !== connectorId &&
            !selected.has(connector.fromId) &&
            !selected.has(connector.toId),
        );
      });
      this.clearSelection();
      this.persistSoon();
    },
    duplicateSelection() {
      if (!this.selectedIds.length) return;
      this.recordMutation('复制所选图元', () => {
        const idMap = new Map<string, string>();
        const topZ = Math.max(0, ...this.nodes.map((item) => item.zIndex));
        const copies = this.selectedNodes.map((node, index) => {
          const id = makeId(node.kind);
          idMap.set(node.id, id);
          return {
            ...clonePlain(node),
            id,
            x: node.x + 32,
            y: node.y + 32,
            // 副本不继承分组，避免悬挂的分组引用。
            groupId: null,
            zIndex: topZ + index + 1,
            rev: 0,
            fields: node.fields.map((field) => ({ ...clonePlain(field), id: makeId('field') })),
          };
        });
        const originalIds = new Set(this.selectedIds);
        const connectorCopies = this.connectors
          .filter(
            (connector) => originalIds.has(connector.fromId) && originalIds.has(connector.toId),
          )
          .map((connector) => ({
            ...clonePlain(connector),
            id: makeId('connector'),
            fromId: idMap.get(connector.fromId) as string,
            toId: idMap.get(connector.toId) as string,
            zIndex: Math.max(0, ...this.connectors.map((item) => item.zIndex)) + 1,
            rev: 0,
          }));
        this.nodes.push(...copies);
        this.connectors.push(...connectorCopies);
        this.selectedIds = copies.map((node) => node.id);
        this.activeNodeId = copies.at(-1)?.id ?? null;
      });
      this.persistSoon();
    },
    groupSelection() {
      if (this.selectedIds.length < 2) return;
      this.recordMutation('图元分组', () => {
        const group: DiagramGroup = {
          id: makeId('group'),
          name: `分组 ${this.groups.length + 1}`,
          color: '#d6e4ff',
          zIndex: Math.max(0, ...this.groups.map((item) => item.zIndex)) + 1,
          rev: 0,
        };
        this.groups.push(group);
        this.nodes.forEach((node) => {
          if (this.selectedIds.includes(node.id)) node.groupId = group.id;
        });
      });
      this.persistSoon();
    },
    ungroupSelection() {
      if (!this.selectedIds.length) return;
      this.recordMutation('取消分组', () => {
        const groupIds = new Set(
          this.nodes
            .filter((node) => this.selectedIds.includes(node.id) && node.groupId)
            .map((node) => node.groupId as string),
        );
        this.nodes.forEach((node) => {
          if (this.selectedIds.includes(node.id)) node.groupId = null;
        });
        this.groups = this.groups.filter((group) => !groupIds.has(group.id));
      });
      this.persistSoon();
    },
    toggleLock() {
      const ids = this.selectedIds.length
        ? this.selectedIds
        : this.selectedConnectorId
          ? [this.selectedConnectorId]
          : [];
      if (!ids.length) return;
      const connectorId = this.selectedConnectorId;
      this.recordMutation('切换锁定', () => {
        if (connectorId) {
          this.connectors.forEach((connector) => {
            if (connector.id === connectorId) connector.locked = !connector.locked;
          });
        } else {
          this.nodes.forEach((node) => {
            if (ids.includes(node.id)) node.locked = !node.locked;
          });
        }
      });
      this.persistSoon();
    },
    changeLayer(direction: 'front' | 'back') {
      const ids = this.selectedIds.length
        ? this.selectedIds
        : this.selectedConnectorId
          ? [this.selectedConnectorId]
          : [];
      if (!ids.length) return;
      const connectorId = this.selectedConnectorId;
      this.recordMutation(direction === 'front' ? '移到顶层' : '移到底层', () => {
        if (connectorId) {
          const connector = this.connectors.find((item) => item.id === connectorId);
          if (connector) {
            connector.zIndex =
              direction === 'front'
                ? Math.max(...this.connectors.map((item) => item.zIndex)) + 1
                : Math.min(...this.connectors.map((item) => item.zIndex)) - 1;
          }
        } else {
          this.nodes.forEach((node) => {
            if (ids.includes(node.id)) {
              node.zIndex =
                direction === 'front'
                  ? Math.max(...this.nodes.map((item) => item.zIndex)) + 1
                  : Math.min(...this.nodes.map((item) => item.zIndex)) - 1;
            }
          });
        }
      });
      this.persistSoon();
    },
    setTitle(title: string) {
      if (title === this.title) return;
      this.recordMutation('修改标题', () => {
        this.title = title;
      });
      this.persistSoon();
    },

    // ---------------------------------------------------------------- 视图状态
    setToolMode(mode: ToolMode) {
      this.toolMode = mode;
    },
    zoomBy(delta: number, origin?: { x: number; y: number }) {
      const nextZoom = Math.min(2.5, Math.max(0.25, this.zoom + delta));
      if (origin) {
        const worldX = (origin.x - this.pan.x) / this.zoom;
        const worldY = (origin.y - this.pan.y) / this.zoom;
        this.pan = {
          x: origin.x - worldX * nextZoom,
          y: origin.y - worldY * nextZoom,
        };
      }
      this.zoom = nextZoom;
    },
    setZoom(zoom: number) {
      this.zoom = Math.min(2.5, Math.max(0.25, zoom));
    },
    fitToView(viewportWidth: number, viewportHeight: number) {
      if (!this.nodes.length) return;
      const minX = Math.min(...this.nodes.map((node) => node.x));
      const minY = Math.min(...this.nodes.map((node) => node.y));
      const maxX = Math.max(...this.nodes.map((node) => node.x + node.width));
      const maxY = Math.max(...this.nodes.map((node) => node.y + node.height));
      const width = maxX - minX;
      const height = maxY - minY;
      this.zoom = Math.min(1.4, Math.max(0.3, Math.min((viewportWidth - 100) / width, (viewportHeight - 100) / height)));
      this.pan = {
        x: (viewportWidth - width * this.zoom) / 2 - minX * this.zoom,
        y: (viewportHeight - height * this.zoom) / 2 - minY * this.zoom,
      };
    },
    markAhead() {
      // 有待决并列两版时继续编辑：让旧预览立即失效并重新评估冲突。
      if (this.pendingMerge) this.refreshPendingStaleness();
      if (this.syncState !== 'conflict') this.syncState = 'ahead';
    },

    // ----------------------------------------------------- 跨标签页 / 合并
    refreshPendingStaleness() {
      const pending = this.pendingMerge;
      if (!pending) return;
      const { conflicts, staleKeys } = threeWayMerge(
        pending.base,
        this.workingSnapshot(),
        pending.remote,
      );
      pending.conflicts = conflicts;
      pending.staleKeys = staleKeys;
      this.conflictKeys = conflicts.map((conflict) => entityKey(conflict.kind, conflict.id));
      this.staleKeys = staleKeys;
    },
    /** 另一标签页写入或文件导入的统一入口；确认前不改当前图。 */
    ingestRemoteDocument(
      remote: DiagramDocument,
      meta: { source: 'tab' | 'import'; sourceLabel: string },
    ): 'fast-forwarded' | 'pending' | 'identical' {
      const sameDoc = remote.docId === this.docId;
      const cleanLocal = !this.localDiverges();

      if (sameDoc && remote.headRev === this.headRev && cleanLocal) return 'identical';

      // 本页没有未提交改动：
      //  - 另一标签页（同文档）→ 快进到对方修订；
      //  - 导入文件（即使是另一份文档）→ 直接载入，不弹并列窗口。
      if (cleanLocal && (sameDoc || meta.source === 'import')) {
        this.fastForwardTo(remote, meta.source);
        return 'fast-forwarded';
      }

      const pending = buildPendingMerge(this.replayBase(), this.workingSnapshot(), remote, {
        source: meta.source,
        sourceLabel: meta.sourceLabel,
        sameDoc,
      });
      this.pendingMerge = pending;
      this.staleKeys = pending.staleKeys;
      this.conflictKeys = pending.conflicts.map((conflict) => entityKey(conflict.kind, conflict.id));
      this.syncState = pending.conflicts.length ? 'conflict' : 'remote-ahead';
      return 'pending';
    },
    localDiverges(): boolean {
      return diffSnapshots(this.replayBase(), this.workingSnapshot()).length > 0;
    },
    fastForwardTo(remote: DiagramDocument, source: 'tab' | 'import') {
      const previousHead = this.headRev;
      this.docId = remote.docId;
      this.headRev = remote.headRev;
      this.localSeq = remote.headRev;
      this.revisions = clonePlain(remote.revisions).slice(-REVISION_LIMIT);
      this.assignSnapshot(toSnapshot(remote));
      this.pendingMerge = null;
      this.staleKeys = [];
      this.conflictKeys = [];
      this.syncState = 'synced';
      this.syncMessage = source === 'tab'
        ? `已同步另一标签页修订 r${previousHead} → r${remote.headRev}`
        : `已跟随导入文件快进到 r${remote.headRev}`;
      this.lastWrittenRaw = '';
    },
    /** 并列两版对话框：逐项选择后确认才改写当前图。 */
    resolvePendingMerge(
      choices: Array<{ id: string; kind: EntityKind | 'title'; choice: 'local' | 'remote' }>,
    ) {
      const pending = this.pendingMerge;
      if (!pending) return;
      pending.conflicts.forEach((conflict) => {
        const picked = choices.find((item) => item.id === conflict.id && item.kind === conflict.kind);
        if (picked) conflict.choice = picked.choice;
      });
      this.commitMerge(pending);
    },
    resolveAll(choice: 'local' | 'remote') {
      const pending = this.pendingMerge;
      if (!pending) return;
      pending.conflicts.forEach((conflict) => {
        conflict.choice = choice;
      });
      this.commitMerge(pending);
    },
    cancelPendingMerge() {
      this.pendingMerge = null;
      this.staleKeys = [];
      this.conflictKeys = [];
      this.syncState = this.localDiverges() ? 'ahead' : 'synced';
    },
    commitMerge(pending: PendingMerge) {
      const local = this.workingSnapshot();
      const { merged: autoMerged } = threeWayMerge(pending.base, local, pending.remote);
      const resolved = applyConflictChoices(autoMerged, pending.conflicts, pending.remote);
      const mergeOps = diffSnapshots(local, resolved);

      const incoming = pending.sameDoc
        ? pending.remoteRevisions.filter((item) => item.id > this.headRev)
        : [];
      const newRev =
        Math.max(
          this.localSeq,
          pending.sameDoc ? pending.remoteHeadRev : this.headRev,
          ...(pending.sameDoc ? pending.remoteRevisions.map((item) => item.id) : [0]),
        ) + 1;

      const stampedMergeOps = stampOps(mergeOps, newRev);
      const stamped = stampSnapshot(resolved, stampedMergeOps, newRev);
      stamped.headRev = newRev;
      const mergeRevision: Revision = {
        id: newRev,
        parentId: pending.sameDoc ? pending.remoteHeadRev : this.headRev,
        docId: pending.sameDoc ? this.docId : pending.remoteDocId,
        mergeBaseId: pending.base.headRev || null,
        author: this.author,
        source: 'merge',
        label:
          pending.source === 'import'
            ? `合并导入文件（${pending.conflicts.length} 处冲突已处理，${pending.autoChangeCount} 项自动并入）`
            : `合并另一标签页（${pending.conflicts.length} 处冲突已处理，${pending.autoChangeCount} 项自动并入）`,
        timestamp: Date.now(),
        ops: clonePlain(stampedMergeOps),
      };

      const chain = pending.sameDoc
        ? [...clonePlain(this.revisions), ...clonePlain(incoming)]
        : [...clonePlain(pending.remoteRevisions)];
      chain.push(mergeRevision);
      const chainTail = chain.slice(-REVISION_LIMIT);

      this.docId = mergeRevision.docId;
      this.headRev = newRev;
      this.localSeq = newRev;
      this.revisions = chainTail;
      this.assignSnapshot(stamped);
      this.historyPast.push({ revision: mergeRevision });
      if (this.historyPast.length > HISTORY_LIMIT) this.historyPast.shift();
      this.historyFuture = [];
      this.pendingMerge = null;
      this.staleKeys = [];
      this.conflictKeys = [];
      // 基线与本页内存已一致，直接发布合并结果，不再重复三向检测。
      const document = documentFromSnapshot(stamped, chainTail, Date.now());
      const published = this.publishDocument(document, newRev, mergeRevision.label, {});
      // publishDocument 会重新 assign（内容相同）；保留合并语义的消息。
      this.syncState = published.ok ? 'synced' : this.syncState;
      this.syncMessage = mergeRevision.label;
    },

    // ------------------------------------------------------------- 持久化
    persistSoon() {
      window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => {
        this.flushPersist();
      }, 350);
    },
    /** 立即把本页改动作为增量修订提交；与磁盘分叉时进入并列两版流程。 */
    flushPersist(options: { retry?: boolean; skipMerge?: boolean } = {}): {
      ok: boolean;
      reason?: string;
    } {
      window.clearTimeout(persistTimer);
      const base = this.replayBase();
      const local = this.workingSnapshot();
      const localOps = diffSnapshots(base, local);

      let remote: DiagramDocument | null = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw && raw !== this.lastWrittenRaw) remote = normalizeDocument(JSON.parse(raw));
      } catch {
        remote = null;
      }

      // 本页没有改动：只需感知另一标签页的推进。
      if (!localOps.length) {
        if (remote && remote.docId === this.docId && remote.headRev > this.headRev) {
          this.ingestRemoteDocument(remote, { source: 'tab', sourceLabel: '另一标签页' });
        }
        return { ok: true, reason: 'no-changes' };
      }

      const remoteAhead =
        remote !== null && remote.docId === this.docId && remote.headRev > this.headRev;
      if (remoteAhead && !options.skipMerge) {
        const remoteDoc = remote as DiagramDocument;
        const pending = buildPendingMerge(base, local, remoteDoc, {
          source: 'tab',
          sourceLabel: '另一标签页',
          sameDoc: true,
        });
        if (pending.conflicts.length) {
          // 确认前不改当前图，只并列两版。
          this.pendingMerge = pending;
          this.staleKeys = pending.staleKeys;
          this.conflictKeys = pending.conflicts.map((conflict) => entityKey(conflict.kind, conflict.id));
          this.syncState = 'conflict';
          return { ok: false, reason: 'conflict' };
        }
        const { merged } = threeWayMerge(base, local, toSnapshot(remoteDoc));
        const newRev = remoteDoc.headRev + 1;
        const mergeOps = diffSnapshots(local, merged);
        const stampedMergeOps = stampOps(mergeOps, newRev);
        const stamped = stampSnapshot(merged, stampedMergeOps, newRev);
        stamped.headRev = newRev;
        const revision: Revision = {
          id: newRev,
          parentId: remoteDoc.headRev,
          docId: this.docId,
          mergeBaseId: this.headRev,
          author: this.author,
          source: 'merge',
          label: `自动合并另一标签页的 ${remoteDoc.headRev - this.headRev} 个修订`,
          timestamp: Date.now(),
          ops: clonePlain(stampedMergeOps),
        };
        const document = documentFromSnapshot(
          stamped,
          [...remoteDoc.revisions, revision].slice(-REVISION_LIMIT),
          Date.now(),
        );
        return this.publishDocument(document, newRev, revision.label, options);
      }

      // 线性提交（磁盘为空、别的文档或同修订号）：只提交本页改动。
      const newRev = (remote && remote.docId === this.docId ? remote.headRev : this.headRev) + 1;
      const stampedLocalOps = stampOps(localOps, newRev);
      const stamped = stampSnapshot(local, stampedLocalOps, newRev);
      stamped.headRev = newRev;
      const revision: Revision = {
        id: newRev,
        parentId: newRev - 1,
        docId: this.docId,
        author: this.author,
        source: 'local',
        label: this.composeLocalLabel(base, local),
        timestamp: Date.now(),
        ops: clonePlain(stampedLocalOps),
      };
      const parentChain =
        remote && remote.docId === this.docId
          ? remote.revisions
          : this.revisions.filter((item) => item.id <= this.headRev);
      const document = documentFromSnapshot(
        stamped,
        [...parentChain, revision].slice(-REVISION_LIMIT),
        Date.now(),
      );
      return this.publishDocument(document, newRev, revision.label, options);
    },
    publishDocument(
      document: DiagramDocument,
      newRev: number,
      message: string,
      options: { retry?: boolean },
    ): { ok: boolean; reason?: string } {
      try {
        writeDocumentCrashSafe(document);
      } catch (error) {
        if (!options.retry) {
          // 保存崩溃：从最后稳定版本恢复并重试一次。
          const recovered = loadStableDocument();
          if (recovered.document) {
            this.syncState = recovered.recoveredFrom === 'staging' ? 'recovered-staging' : 'recovered-stable';
            this.syncMessage = '保存中断，已从最后稳定版本恢复并重试';
            const retryDocument: DiagramDocument = { ...clonePlain(document), updatedAt: Date.now() };
            const retryResult = this.publishDocument(retryDocument, newRev, message, { retry: true });
            if (retryResult.ok) return retryResult;
            // 重试仍失败：工作区回退到稳定版本，保留明确的恢复点。
            this.docId = recovered.document.docId;
            this.headRev = recovered.document.headRev;
            this.localSeq = recovered.document.headRev;
            this.revisions = clonePlain(recovered.document.revisions);
            this.assignSnapshot(toSnapshot(recovered.document));
            this.syncMessage = '保存失败，当前画布已回退到最后稳定版本';
            return retryResult;
          }
        }
        return { ok: false, reason: error instanceof Error ? error.message : '本机写入失败' };
      }
      // 提交成功：推进基线，当前图内容不变。
      this.revisions = clonePlain(document.revisions);
      this.headRev = newRev;
      this.localSeq = newRev;
      this.assignSnapshot(toSnapshot(document));
      this.staleKeys = [];
      this.conflictKeys = [];
      this.pendingMerge = null;
      this.syncState = 'synced';
      this.syncMessage = message;
      this.lastWrittenRaw = JSON.stringify(document);
      return { ok: true };
    },
    composeLocalLabel(base: DiagramSnapshot, local: DiagramSnapshot): string {
      const ops = diffSnapshots(base, local);
      const labels = new Set(
        ops.map((op) =>
          op.type === 'set-title' ? '标题' : op.type === 'add' ? '新增对象' : op.type === 'remove' ? '删除对象' : '更新对象',
        ),
      );
      return [...labels].join('、') || '更新画布';
    },

    // --------------------------------------------------------------- 导入
    /**
     * 导入：v1 旧稿先升级身份与修订号；v2 按稳定身份三向合并。
     * 坏文件不改当前图，并从最后稳定版本恢复后重试一次待保存内容。
     */
    importJson(raw: string, fileName: string): { ok: boolean; error?: string; pending?: boolean } {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.recoverAfterBadImport();
        return { ok: false, error: '文件不是合法 JSON，当前画布未改动；已恢复稳定草稿。' };
      }

      let document: DiagramDocument;
      if (isLegacyDocument(parsed)) {
        document = migrateLegacy(parsed);
      } else {
        const normalized = normalizeDocument(parsed);
        if (!normalized) {
          this.recoverAfterBadImport();
          return {
            ok: false,
            error: '文件结构不符合 FrameFlow v2 修订格式，当前画布未改动；已恢复稳定草稿。',
          };
        }
        document = normalized;
      }

      const status = this.ingestRemoteDocument(document, { source: 'import', sourceLabel: fileName });
      if (status === 'fast-forwarded' || status === 'identical') {
        this.flushPersist();
        return { ok: true };
      }
      return { ok: true, pending: true };
    },
    recoverAfterBadImport() {
      const recovered = loadStableDocument();
      if (recovered.document && recovered.recoveredFrom !== 'main') {
        this.syncState = recovered.recoveredFrom === 'staging' ? 'recovered-staging' : 'recovered-stable';
        this.syncMessage = '导入失败，已从最后稳定版本恢复本机草稿';
      }
      const retry = this.flushPersist({ retry: true });
      if (!retry.ok) {
        this.syncMessage = '稳定版本已恢复，请手动保存一次';
      }
    },

    // ------------------------------------------------- 跨标签页 storage 监听
    bindStorageSync() {
      window.addEventListener('storage', this.handleStorageEvent);
    },
    teardownStorageSync() {
      window.removeEventListener('storage', this.handleStorageEvent);
    },
    handleStorageEvent(event: StorageEvent) {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      if (event.newValue === this.lastWrittenRaw) return;
      let remote: DiagramDocument | null = null;
      try {
        remote = normalizeDocument(JSON.parse(event.newValue));
      } catch {
        remote = null;
      }
      if (!remote) return;
      this.ingestRemoteDocument(remote, { source: 'tab', sourceLabel: '另一标签页' });
    },

    // ----------------------------------------------------- 旧接口兼容垫片
    /** 拖拽在 dragend 通过 commitPositions 产生一条修订，dragstart 无需额外快照。 */
    checkpoint() {},
    updateNode(id: string, patch: Partial<DiagramNode>) {
      this.patchNode(id, patch);
    },
    updateConnector(id: string, patch: Partial<DiagramConnector>) {
      this.patchConnector(id, patch);
    },
    importDocument(document: DiagramDocument) {
      this.ingestRemoteDocument(document, { source: 'import', sourceLabel: '导入文件' });
    },
  },
});
