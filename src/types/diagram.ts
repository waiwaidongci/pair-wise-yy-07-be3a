export type NodeKind = 'rectangle' | 'circle' | 'diamond' | 'table';
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';
export type ToolMode = 'select' | 'connect';
export type EntityKind = 'node' | 'connector' | 'group';

/** 表字段是一等对象：拥有稳定身份，修改同一字段才能被识别为同一对象的修订。 */
export interface FieldDef {
  id: string;
  text: string;
}

export interface Revisioned {
  /** 最后修改本对象的修订号；对象的稳定身份由 id 承担。 */
  rev: number;
}

export interface DiagramNode extends Revisioned {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  locked: boolean;
  groupId: string | null;
  zIndex: number;
  fields: FieldDef[];
}

export interface DiagramConnector extends Revisioned {
  id: string;
  fromId: string;
  toId: string;
  fromAnchor: AnchorSide;
  toAnchor: AnchorSide;
  label: string;
  color: string;
  dashed: boolean;
  locked: boolean;
  zIndex: number;
}

export interface DiagramGroup extends Revisioned {
  id: string;
  name: string;
  color: string;
  zIndex: number;
}

export type RevisionEntity = DiagramNode | DiagramConnector | DiagramGroup;

export type RevisionOpType = 'add' | 'update' | 'remove';

export interface RevisionEntityOp {
  type: RevisionOpType;
  kind: EntityKind;
  id: string;
  /** add/update 时为改动前快照；remove 时为被删除对象快照。 */
  before?: RevisionEntity;
  /** add/update 时为改动后快照；remove 时缺省。 */
  after?: RevisionEntity;
}

export interface RevisionTitleOp {
  type: 'set-title';
  before: string;
  after: string;
}

export type RevisionOp = RevisionEntityOp | RevisionTitleOp;

export type RevisionSource = 'bootstrap' | 'local' | 'merge' | 'migration';

/** 修订链上的一个不可变节点。 */
export interface Revision {
  id: number;
  parentId: number | null;
  docId: string;
  /** 合并修订记录三向合并的共同基线，普通修订不填。 */
  mergeBaseId?: number | null;
  author: string;
  source: RevisionSource;
  label: string;
  timestamp: number;
  ops: RevisionOp[];
}

/** v2 文档：对象带稳定身份与修订号，修订关系完整落盘。 */
export interface DiagramDocument {
  formatVersion: 2;
  docId: string;
  title: string;
  titleRev: number;
  headRev: number;
  nodes: DiagramNode[];
  connectors: DiagramConnector[];
  groups: DiagramGroup[];
  revisions: Revision[];
  updatedAt: number;
}

/** 某一时刻的完整画布状态，是三向合并与差异计算的基本单位。 */
export interface DiagramSnapshot {
  docId: string;
  title: string;
  titleRev: number;
  headRev: number;
  nodes: DiagramNode[];
  connectors: DiagramConnector[];
  groups: DiagramGroup[];
}

export interface LegacyDiagramNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  locked: boolean;
  groupId: string | null;
  zIndex: number;
  fields: string[];
}

export interface LegacyDiagramConnector {
  id: string;
  fromId: string;
  toId: string;
  fromAnchor: AnchorSide;
  toAnchor: AnchorSide;
  label: string;
  color: string;
  dashed: boolean;
  locked: boolean;
  zIndex: number;
}

/** v1 旧稿：整份覆盖格式，打开时先迁移到 v2 身份与修订号。 */
export interface LegacyDiagramDocument {
  version: 1;
  title: string;
  nodes: LegacyDiagramNode[];
  connectors: LegacyDiagramConnector[];
  groups?: DiagramGroup[];
  updatedAt: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface AnchorPoint extends Point {
  side: AnchorSide;
}

export interface AlignmentGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
  label: string;
}

export interface MergeConflict {
  kind: EntityKind | 'title';
  id: string;
  label: string;
  base: RevisionEntity | null;
  local: RevisionEntity | null;
  remote: RevisionEntity | null;
  /** 标题冲突时的三方文本。 */
  baseTitle?: string;
  localTitle?: string;
  remoteTitle?: string;
  choice: 'local' | 'remote';
}

export interface PendingMerge {
  source: 'tab' | 'import';
  sourceLabel: string;
  sameDoc: boolean;
  remoteDocId: string;
  remoteHeadRev: number;
  remoteUpdatedAt: number;
  /** 共同基线（跨文档导入时以当前画布为基线）。 */
  base: DiagramSnapshot;
  remote: DiagramSnapshot;
  remoteRevisions: Revision[];
  conflicts: MergeConflict[];
  /** 另一页改动过、与本页未提交改动重叠的对象：旧预览立即失效。 */
  staleKeys: string[];
  /** 不冲突、确认时自动并入的对象数。 */
  autoChangeCount: number;
}
