export type NodeKind = 'rectangle' | 'circle' | 'diamond' | 'table';
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';
export type ToolMode = 'select' | 'connect';

export interface DiagramNode {
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

export interface DiagramConnector {
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

export interface DiagramDocument {
  version: 1;
  title: string;
  nodes: DiagramNode[];
  connectors: DiagramConnector[];
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
