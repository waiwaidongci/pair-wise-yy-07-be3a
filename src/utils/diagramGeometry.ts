import type {
  AlignmentGuide,
  AnchorPoint,
  AnchorSide,
  DiagramConnector,
  DiagramNode,
  Point,
} from '../types/diagram';

export const DEFAULT_NODE_SIZE: Record<DiagramNode['kind'], { width: number; height: number }> = {
  rectangle: { width: 160, height: 72 },
  circle: { width: 110, height: 110 },
  diamond: { width: 140, height: 110 },
  table: { width: 210, height: 152 },
};

export function anchorPoint(node: DiagramNode, side: AnchorSide): AnchorPoint {
  const center = nodeCenter(node);
  if (side === 'top') return { x: center.x, y: node.y, side };
  if (side === 'right') return { x: node.x + node.width, y: center.y, side };
  if (side === 'bottom') return { x: center.x, y: node.y + node.height, side };
  return { x: node.x, y: center.y, side };
}

export function nodeCenter(node: DiagramNode): Point {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

export function chooseAnchors(from: DiagramNode, to: DiagramNode) {
  const deltaX = nodeCenter(to).x - nodeCenter(from).x;
  const deltaY = nodeCenter(to).y - nodeCenter(from).y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return {
      from: deltaX >= 0 ? 'right' : 'left',
      to: deltaX >= 0 ? 'left' : 'right',
    } satisfies { from: AnchorSide; to: AnchorSide };
  }
  return {
    from: deltaY >= 0 ? 'bottom' : 'top',
    to: deltaY >= 0 ? 'top' : 'bottom',
  };
}

export function routeConnector(
  connector: DiagramConnector,
  nodes: DiagramNode[],
): number[] {
  const from = nodes.find((node) => node.id === connector.fromId);
  const to = nodes.find((node) => node.id === connector.toId);
  if (!from || !to) return [];
  const start = anchorPoint(from, connector.fromAnchor);
  const end = anchorPoint(to, connector.toAnchor);
  const startDirection = directionForAnchor(connector.fromAnchor);
  const endDirection = directionForAnchor(connector.toAnchor);
  const startLead = {
    x: start.x + startDirection.x * 26,
    y: start.y + startDirection.y * 26,
  };
  const endLead = {
    x: end.x + endDirection.x * 26,
    y: end.y + endDirection.y * 26,
  };
  const path = orthogonalPath(startLead, endLead);
  const obstacles = nodes.filter((node) => node.id !== from.id && node.id !== to.id);
  const collides = path.some((point, index) => {
    if (index === path.length - 1) return false;
    const next = path[index + 1];
    return obstacles.some((node) => segmentIntersectsNode(point, next, node, 12));
  });
  if (!collides) return flattenPoints([start, ...path, end]);

  const bounds = mergedBounds([from, to]);
  const routeY = bounds.y - 48;
  const detour = [
    start,
    startLead,
    { x: startLead.x, y: routeY },
    { x: endLead.x, y: routeY },
    endLead,
    end,
  ];
  return flattenPoints(dedupePoints(detour));
}

function directionForAnchor(side: AnchorSide): Point {
  if (side === 'top') return { x: 0, y: -1 };
  if (side === 'right') return { x: 1, y: 0 };
  if (side === 'bottom') return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

function orthogonalPath(start: Point, end: Point): Point[] {
  if (Math.abs(start.x - end.x) < 2 || Math.abs(start.y - end.y) < 2) {
    return [start, end];
  }
  const horizontalFirst = Math.abs(end.x - start.x) > Math.abs(end.y - start.y);
  return horizontalFirst
    ? [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end]
    : [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end];
}

function segmentIntersectsNode(start: Point, end: Point, node: DiagramNode, padding: number) {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return (
    maxX >= node.x - padding &&
    minX <= node.x + node.width + padding &&
    maxY >= node.y - padding &&
    minY <= node.y + node.height + padding
  );
}

function mergedBounds(nodes: DiagramNode[]) {
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  return { x: minX, y: minY };
}

function flattenPoints(points: Point[]): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

function dedupePoints(points: Point[]): Point[] {
  return points.filter(
    (point, index) =>
      index === 0 ||
      point.x !== points[index - 1].x ||
      point.y !== points[index - 1].y,
  );
}

export function calculateAlignmentGuides(
  activeNodes: DiagramNode[],
  allNodes: DiagramNode[],
  threshold: number,
): AlignmentGuide[] {
  const activeIds = new Set(activeNodes.map((node) => node.id));
  const otherNodes = allNodes.filter((node) => !activeIds.has(node.id));
  const guides: AlignmentGuide[] = [];
  if (!activeNodes.length || activeNodes.length > 1) return guides;
  const active = activeNodes[0];
  const activePoints = {
    x: [active.x, active.x + active.width / 2, active.x + active.width],
    y: [active.y, active.y + active.height / 2, active.y + active.height],
  };
  otherNodes.forEach((other) => {
    const otherX = [other.x, other.x + other.width / 2, other.x + other.width];
    const otherY = [other.y, other.y + other.height / 2, other.y + other.height];
    otherX.forEach((position) => {
      activePoints.x.forEach((activePosition) => {
        if (Math.abs(position - activePosition) <= threshold) {
          guides.push({
            orientation: 'vertical',
            position,
            start: Math.min(active.y, other.y) - 20,
            end: Math.max(active.y + active.height, other.y + other.height) + 20,
            label: `${Math.round(Math.abs(active.y - other.y))} px`,
          });
        }
      });
    });
    otherY.forEach((position) => {
      activePoints.y.forEach((activePosition) => {
        if (Math.abs(position - activePosition) <= threshold) {
          guides.push({
            orientation: 'horizontal',
            position,
            start: Math.min(active.x, other.x) - 20,
            end: Math.max(active.x + active.width, other.x + other.width) + 20,
            label: `${Math.round(Math.abs(active.x - other.x))} px`,
          });
        }
      });
    });
  });
  return guides.slice(0, 8);
}
