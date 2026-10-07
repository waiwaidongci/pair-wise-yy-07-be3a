export type NodeKind = 'rectangle' | 'circle' | 'diamond' | 'table';
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';
export type ToolMode = 'select' | 'connect';

/** 字段：带稳定身份与独立修订号，跨标签页合并时按身份对齐。 */
export interface NodeField {
  id: string;
  text: string;
  rev: number;
}

/** 分组：一等修订对象，成员关系同时冗余在 node.groupId 上用于渲染。 */
export interface DiagramGroup {
  id: string;
  rev: number;
  name: string;
}

export interface DiagramNode {
  id: string;
  /** 节点级修订号，随每次内容修改递增。 */
  rev: number;
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
  fields: NodeField[];
}

export interface DiagramConnector {
  id: string;
  /** 连线级修订号。 */
  rev: number;
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

export interface DiagramDocument {
  version: 2;
  /** 全局文档修订号，只增不减；对象 rev 取其最后一次修改时的 docRev。 */
  docRev: number;
  title: string;
  nodes: DiagramNode[];
  connectors: DiagramConnector[];
  groups: DiagramGroup[];
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

/** 三方合并后的一处冲突：同一对象在本机与远端都被改过。 */
export interface ConflictItem {
  kind: 'node' | 'connector' | 'group' | 'title';
  id: string;
  label: string;
  base: unknown;
  local: unknown;
  remote: unknown;
  choice: 'local' | 'remote';
}

/** 冲突预览：确认前当前图不变，preview 是并入「仅远端改动」后的结果。 */
export interface ConflictState {
  remote: DiagramDocument;
  preview: DiagramDocument;
  items: ConflictItem[];
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
