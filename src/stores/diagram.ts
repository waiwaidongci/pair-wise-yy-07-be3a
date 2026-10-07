import { defineStore } from 'pinia';
import type {
  ConflictState,
  DiagramConnector,
  DiagramDocument,
  DiagramGroup,
  DiagramNode,
  NodeKind,
  SaveState,
  ToolMode,
} from '../types/diagram';
import { DEFAULT_NODE_SIZE } from '../utils/diagramGeometry';
import {
  clonePlain,
  finalizeMerge,
  makeId,
  mergeDoc,
  migrateDoc,
  newField,
} from '../utils/revisions';

const STORAGE_KEY_STABLE = 'pair-wise-yy-07-diagram';
const STORAGE_KEY_PENDING = 'pair-wise-yy-07-diagram-pending';
let persistTimer: number | undefined;

interface HistoryState {
  past: DiagramDocument[];
  future: DiagramDocument[];
}

interface StorageEnvelope {
  version: number;
  doc: unknown;
}

function readEnvelope(key: string): StorageEnvelope | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StorageEnvelope;
    if (parsed && typeof parsed === 'object' && parsed.doc) return parsed;
    // 兼容历史裸文档（无信封）。
    if (parsed && typeof parsed === 'object' && (parsed as { version?: number }).version === 1) {
      return { version: 1, doc: parsed };
    }
    return null;
  } catch {
    return null;
  }
}

function buildInitialDoc(): DiagramDocument {
  const nodes: DiagramNode[] = [
    {
      id: 'table-customers',
      rev: 1,
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
      fields: [
        'id  BIGINT PK',
        'name  VARCHAR(80)',
        'region  VARCHAR(20)',
        'credit_limit DECIMAL',
      ].map((text) => newField(text, 1)),
    },
    {
      id: 'table-orders',
      rev: 1,
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
      fields: [
        'id  BIGINT PK',
        'customer_id  BIGINT FK',
        'amount  DECIMAL',
        'status VARCHAR(20)',
      ].map((text) => newField(text, 1)),
    },
    {
      id: 'node-review',
      rev: 1,
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
      fields: [],
    },
    {
      id: 'node-fulfill',
      rev: 1,
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
      fields: [],
    },
    {
      id: 'node-close',
      rev: 1,
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
      fields: [],
    },
  ];
  const connectors: DiagramConnector[] = [
    {
      id: 'connector-customer-orders',
      rev: 1,
      fromId: 'table-customers',
      toId: 'table-orders',
      fromAnchor: 'right',
      toAnchor: 'left',
      label: '1 : N',
      color: '#1f6feb',
      dashed: false,
      locked: false,
      zIndex: 1,
    },
    {
      id: 'connector-orders-review',
      rev: 1,
      fromId: 'table-orders',
      toId: 'node-review',
      fromAnchor: 'bottom',
      toAnchor: 'top',
      label: '校验',
      color: '#667085',
      dashed: false,
      locked: false,
      zIndex: 2,
    },
    {
      id: 'connector-review-fulfill',
      rev: 1,
      fromId: 'node-review',
      toId: 'node-fulfill',
      fromAnchor: 'right',
      toAnchor: 'left',
      label: '是',
      color: '#12805c',
      dashed: false,
      locked: false,
      zIndex: 3,
    },
    {
      id: 'connector-review-close',
      rev: 1,
      fromId: 'node-review',
      toId: 'node-close',
      fromAnchor: 'top',
      toAnchor: 'bottom',
      label: '驳回',
      color: '#c2413b',
      dashed: true,
      locked: false,
      zIndex: 4,
    },
  ];
  return {
    version: 2,
    docRev: 1,
    title: '订单履约架构图',
    nodes,
    connectors,
    groups: [],
    updatedAt: Date.now(),
  };
}

/** 启动恢复：pending 存在说明上次保存中断，从最后稳定版本恢复。 */
function recoverDoc(): { doc: DiagramDocument; hadPending: boolean } {
  const stable = readEnvelope(STORAGE_KEY_STABLE);
  const pending = readEnvelope(STORAGE_KEY_PENDING);
  if (pending) {
    if (stable) {
      const migrated = migrateDoc(stable.doc);
      if (migrated.ok) return { doc: migrated.doc, hadPending: true };
    }
    const migratedPending = migrateDoc(pending.doc);
    if (migratedPending.ok) return { doc: migratedPending.doc, hadPending: true };
    return { doc: buildInitialDoc(), hadPending: true };
  }
  if (stable) {
    const migrated = migrateDoc(stable.doc);
    if (migrated.ok) return { doc: migrated.doc, hadPending: false };
  }
  return { doc: buildInitialDoc(), hadPending: false };
}

const recovered = recoverDoc();

export const useDiagramStore = defineStore('diagram', {
  state: () => ({
    docRev: recovered.doc.docRev,
    title: recovered.doc.title,
    nodes: recovered.doc.nodes,
    connectors: recovered.doc.connectors,
    groups: recovered.doc.groups,
    /** 上次稳定保存的快照，三方合并的基线。 */
    base: clonePlain(recovered.doc) as DiagramDocument,
    recoveredFromCrash: recovered.hadPending,
    /** 冲突预览；确认前当前图不变。 */
    conflicts: null as ConflictState | null,
    saveState: 'idle' as SaveState,
    lastSavedAt: null as number | null,
    saveError: null as string | null,
    /** 最近一次自动并入的远端改动数，供视图层提示。 */
    lastAutoMerged: 0,
    selectedIds: [] as string[],
    selectedConnectorId: null as string | null,
    activeNodeId: null as string | null,
    toolMode: 'select' as ToolMode,
    zoom: 1,
    pan: { x: 36, y: 24 },
    snapToGrid: true,
    gridSize: 20,
    history: { past: [], future: [] } as HistoryState,
  }),
  getters: {
    selectedNodes(state): DiagramNode[] {
      return state.nodes.filter((node) => state.selectedIds.includes(node.id));
    },
    activeNode(state): DiagramNode | null {
      return state.nodes.find((node) => node.id === state.activeNodeId) ?? null;
    },
    canUndo: (state) => state.history.past.length > 0,
    canRedo: (state) => state.history.future.length > 0,
    conflictCount: (state) => state.conflicts?.items.length ?? 0,
  },
  actions: {
    touchNode(node: DiagramNode) {
      node.rev = this.docRev;
    },
    touchConnector(connector: DiagramConnector) {
      connector.rev = this.docRev;
    },
    touchGroup(group: DiagramGroup) {
      group.rev = this.docRev;
    },
    snapshot(): DiagramDocument {
      return {
        version: 2,
        docRev: this.docRev,
        title: this.title,
        nodes: clonePlain(this.nodes),
        connectors: clonePlain(this.connectors),
        groups: clonePlain(this.groups),
        updatedAt: Date.now(),
      };
    },
    checkpoint() {
      this.docRev += 1;
      this.history.past.push(this.snapshot());
      if (this.history.past.length > 80) this.history.past.shift();
      this.history.future = [];
    },
    undo() {
      const previous = this.history.past.pop();
      if (!previous) return;
      this.history.future.push(this.snapshot());
      this.restore(previous);
    },
    redo() {
      const next = this.history.future.pop();
      if (!next) return;
      this.history.past.push(this.snapshot());
      this.restore(next);
    },
    restore(document: DiagramDocument) {
      this.title = document.title;
      this.nodes = clonePlain(document.nodes);
      this.connectors = clonePlain(document.connectors);
      this.groups = clonePlain(document.groups);
      // docRev 只增不减：撤销重做回退对象 rev，但全局修订号保持单调。
      this.docRev = Math.max(this.docRev, document.docRev);
      this.selectedIds = this.selectedIds.filter((id) => this.nodes.some((node) => node.id === id));
      this.selectedConnectorId = null;
      this.activeNodeId = this.selectedIds.at(-1) ?? null;
    },
    setTitle(title: string) {
      if (this.title === title) return;
      this.checkpoint();
      this.title = title;
      this.persistSoon();
    },
    addNode(kind: NodeKind, position?: { x: number; y: number }) {
      this.checkpoint();
      const size = DEFAULT_NODE_SIZE[kind];
      const point = position ?? {
        x: 220 + (this.nodes.length % 4) * 26,
        y: 220 + (this.nodes.length % 3) * 24,
      };
      const node: DiagramNode = {
        id: makeId(kind),
        rev: this.docRev,
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
        fields:
          kind === 'table'
            ? ['id  BIGINT PK', 'name  VARCHAR(80)'].map((text) => newField(text, this.docRev))
            : [],
      };
      this.nodes.push(node);
      this.selectNode(node.id);
      this.persistSoon();
    },
    updateNode(id: string, patch: Partial<DiagramNode>) {
      const node = this.nodes.find((item) => item.id === id);
      if (!node) return;
      Object.assign(node, patch);
      this.touchNode(node);
      this.persistSoon();
    },
    patchNode(id: string, patch: Partial<DiagramNode>) {
      this.checkpoint();
      this.updateNode(id, patch);
    },
    commitPositions(positions: Record<string, { x: number; y: number }>) {
      Object.entries(positions).forEach(([id, point]) => {
        const node = this.nodes.find((item) => item.id === id);
        if (node) {
          node.x = point.x;
          node.y = point.y;
          this.touchNode(node);
        }
      });
      this.persistSoon();
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
      this.checkpoint();
      this.connectors.push({
        id: makeId('connector'),
        rev: this.docRev,
        fromId,
        toId,
        fromAnchor,
        toAnchor,
        label: '',
        color: '#667085',
        dashed: false,
        locked: false,
        zIndex: Math.max(0, ...this.connectors.map((item) => item.zIndex)) + 1,
      });
      this.persistSoon();
    },
    updateConnector(id: string, patch: Partial<DiagramConnector>) {
      const connector = this.connectors.find((item) => item.id === id);
      if (!connector) return;
      Object.assign(connector, patch);
      this.touchConnector(connector);
      this.persistSoon();
    },
    patchConnector(id: string, patch: Partial<DiagramConnector>) {
      this.checkpoint();
      this.updateConnector(id, patch);
    },
    deleteSelection() {
      if (!this.selectedIds.length && !this.selectedConnectorId) return;
      this.checkpoint();
      const selected = new Set(this.selectedIds);
      this.nodes = this.nodes.filter((node) => !selected.has(node.id));
      this.connectors = this.connectors.filter(
        (connector) =>
          connector.id !== this.selectedConnectorId &&
          !selected.has(connector.fromId) &&
          !selected.has(connector.toId),
      );
      // 清理已空的分组。
      const remainingGroupIds = new Set(
        this.nodes.map((node) => node.groupId).filter((id): id is string => id !== null),
      );
      this.groups = this.groups.filter((group) => remainingGroupIds.has(group.id));
      this.clearSelection();
      this.persistSoon();
    },
    duplicateSelection() {
      if (!this.selectedIds.length) return;
      this.checkpoint();
      const idMap = new Map<string, string>();
      const copies = this.selectedNodes.map((node) => {
        const id = makeId(node.kind);
        idMap.set(node.id, id);
        return {
          ...clonePlain(node),
          id,
          rev: this.docRev,
          x: node.x + 32,
          y: node.y + 32,
          zIndex: Math.max(0, ...this.nodes.map((item) => item.zIndex)) + idMap.size,
          fields: node.fields.map((field) => newField(field.text, this.docRev)),
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
          rev: this.docRev,
          fromId: idMap.get(connector.fromId) as string,
          toId: idMap.get(connector.toId) as string,
          zIndex: Math.max(0, ...this.connectors.map((item) => item.zIndex)) + 1,
        }));
      this.nodes.push(...copies);
      this.connectors.push(...connectorCopies);
      this.selectedIds = copies.map((node) => node.id);
      this.activeNodeId = copies.at(-1)?.id ?? null;
      this.persistSoon();
    },
    groupSelection() {
      if (this.selectedIds.length < 2) return;
      this.checkpoint();
      const groupId = makeId('group');
      const group: DiagramGroup = { id: groupId, rev: this.docRev, name: '分组' };
      this.groups.push(group);
      this.nodes.forEach((node) => {
        if (this.selectedIds.includes(node.id)) {
          node.groupId = groupId;
          this.touchNode(node);
        }
      });
      this.persistSoon();
    },
    ungroupSelection() {
      if (!this.selectedIds.length) return;
      this.checkpoint();
      const groupIds = new Set(
        this.nodes
          .filter((node) => this.selectedIds.includes(node.id) && node.groupId)
          .map((node) => node.groupId as string),
      );
      this.groups = this.groups.filter((group) => !groupIds.has(group.id));
      this.nodes.forEach((node) => {
        if (this.selectedIds.includes(node.id) && node.groupId) {
          node.groupId = null;
          this.touchNode(node);
        }
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
      this.checkpoint();
      if (this.selectedConnectorId) {
        this.connectors.forEach((connector) => {
          if (connector.id === this.selectedConnectorId) {
            connector.locked = !connector.locked;
            this.touchConnector(connector);
          }
        });
      } else {
        this.nodes.forEach((node) => {
          if (ids.includes(node.id)) {
            node.locked = !node.locked;
            this.touchNode(node);
          }
        });
      }
      this.persistSoon();
    },
    changeLayer(direction: 'front' | 'back') {
      const ids = this.selectedIds.length
        ? this.selectedIds
        : this.selectedConnectorId
          ? [this.selectedConnectorId]
          : [];
      if (!ids.length) return;
      this.checkpoint();
      if (this.selectedConnectorId) {
        const connector = this.connectors.find((item) => item.id === this.selectedConnectorId);
        if (connector) {
          connector.zIndex =
            direction === 'front'
              ? Math.max(...this.connectors.map((item) => item.zIndex)) + 1
              : Math.min(...this.connectors.map((item) => item.zIndex)) - 1;
          this.touchConnector(connector);
        }
      } else {
        this.nodes.forEach((node) => {
          if (ids.includes(node.id)) {
            node.zIndex =
              direction === 'front'
                ? Math.max(...this.nodes.map((item) => item.zIndex)) + 1
                : Math.min(...this.nodes.map((item) => item.zIndex)) - 1;
            this.touchNode(node);
          }
        });
      }
      this.persistSoon();
    },
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
      this.zoom = Math.min(
        1.4,
        Math.max(0.3, Math.min((viewportWidth - 100) / width, (viewportHeight - 100) / height)),
      );
      this.pan = {
        x: (viewportWidth - width * this.zoom) / 2 - minX * this.zoom,
        y: (viewportHeight - height * this.zoom) / 2 - minY * this.zoom,
      };
    },
    /** 导入外部文件：先升级/校验，坏文件直接拒绝，绝不覆盖当前图。 */
    importDocument(fileDoc: unknown) {
      const migrated = migrateDoc(fileDoc);
      if (!migrated.ok) {
        throw new Error(migrated.error);
      }
      this.applyRemote(migrated.doc);
    },
    /** 应用远端（另一标签页或导入）文档：三方合并，冲突进预览不改当前图。 */
    applyRemote(remote: DiagramDocument) {
      if (remote.docRev <= (this.base?.docRev ?? 0)) return;
      const base = this.base ?? clonePlain(this.snapshot());
      const result = mergeDoc(base, this.snapshot(), remote);
      if (result.items.length) {
        // 预览随远端即时失效重算；确认前当前图不变。
        this.conflicts = { remote, preview: result.preview, items: result.items };
      } else {
        this.adoptMerged(result.preview, remote, result.autoMerged);
      }
    },
    adoptMerged(doc: DiagramDocument, remote: DiagramDocument, autoMerged = 0) {
      this.title = doc.title;
      this.nodes = doc.nodes;
      this.connectors = doc.connectors;
      this.groups = doc.groups;
      this.docRev = Math.max(this.docRev, remote.docRev);
      this.base = clonePlain(doc);
      this.history = { past: [], future: [] };
      this.conflicts = null;
      this.persistSoon();
      if (autoMerged > 0) {
        // 通知由视图层弹出，这里只留标记。
        this.lastAutoMerged = autoMerged;
      }
    },
    /** 按用户在并列两版中的选择完成合并。 */
    resolveConflict() {
      if (!this.conflicts) return;
      const doc = finalizeMerge(
        this.conflicts.preview,
        this.conflicts.remote,
        this.conflicts.items,
      );
      this.adoptMerged(doc, this.conflicts.remote);
    },
    resolveAll(which: 'local' | 'remote') {
      if (!this.conflicts) return;
      this.conflicts.items.forEach((item) => {
        item.choice = which;
      });
      this.resolveConflict();
    },
    /** 监听其他标签页的稳定提交。 */
    startSync() {
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY_STABLE || !event.newValue) return;
        const envelope = readEnvelope(STORAGE_KEY_STABLE);
        if (!envelope) return;
        const migrated = migrateDoc(envelope.doc);
        if (!migrated.ok) return;
        this.applyRemote(migrated.doc);
      });
    },
    /** 两段式保存：先写 pending 再写 stable，崩溃后靠 pending 恢复。 */
    async writeSave(doc: DiagramDocument) {
      const pending = JSON.stringify({ saveId: makeId('save'), doc });
      const stable = JSON.stringify({ version: 2, doc });
      localStorage.setItem(STORAGE_KEY_PENDING, pending);
      localStorage.setItem(STORAGE_KEY_STABLE, stable);
      localStorage.removeItem(STORAGE_KEY_PENDING);
    },
    async saveNow() {
      this.saveState = 'saving';
      this.saveError = null;
      try {
        const doc = this.snapshot();
        await this.writeSave(doc);
        this.base = clonePlain(doc);
        this.saveState = 'saved';
        this.lastSavedAt = Date.now();
      } catch (error) {
        this.saveState = 'error';
        this.saveError = error instanceof Error ? error.message : '保存失败，可重试';
      }
    },
    persistSoon() {
      window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => {
        void this.saveNow();
      }, 180);
    },
  },
});
