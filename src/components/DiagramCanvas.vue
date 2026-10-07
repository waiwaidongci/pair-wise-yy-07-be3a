<script setup lang="ts">
import Konva from 'konva';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useDiagramStore } from '../stores/diagram';
import type {
  AnchorPoint,
  AnchorSide,
  DiagramConnector,
  DiagramNode,
  NodeKind,
  Point,
} from '../types/diagram';
import {
  anchorPoint,
  calculateAlignmentGuides,
  nodeCenter,
  routeConnector,
} from '../utils/diagramGeometry';
import MiniMap from './MiniMap.vue';

const store = useDiagramStore();
const containerRef = ref<HTMLDivElement | null>(null);
const stageHostRef = ref<HTMLDivElement | null>(null);
const stageRef = shallowRef<Konva.Stage | null>(null);
const contentLayerRef = shallowRef<Konva.Layer | null>(null);
const guideLayerRef = shallowRef<Konva.Layer | null>(null);
const viewport = ref({ width: 900, height: 650 });
const isPanning = ref(false);
const tempConnection = ref<{ start: AnchorPoint; fromId: string } | null>(null);
let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
let resizeObserver: ResizeObserver | null = null;
let dragState:
  | {
      ids: string[];
      primaryId: string;
      startPositions: Record<string, Point>;
      moved: boolean;
    }
  | null = null;

const zoomPercent = computed(() => `${Math.round(store.zoom * 100)}%`);

function initializeStage() {
  const host = stageHostRef.value;
  const container = containerRef.value;
  if (!host || !container) return;
  const rect = container.getBoundingClientRect();
  viewport.value = { width: rect.width, height: rect.height };
  const stage = new Konva.Stage({
    container: host,
    width: rect.width,
    height: rect.height,
  });
  const contentLayer = new Konva.Layer();
  const guideLayer = new Konva.Layer({ listening: false });
  stage.add(contentLayer);
  stage.add(guideLayer);
  stageRef.value = stage;
  contentLayerRef.value = contentLayer;
  guideLayerRef.value = guideLayer;

  stage.on('wheel', (event) => {
    event.evt.preventDefault();
    const pointer = stage.getPointerPosition();
    const direction = event.evt.deltaY > 0 ? -0.08 : 0.08;
    store.zoomBy(direction, pointer ?? undefined);
    applyViewport();
  });
  stage.on('mousedown', (event) => {
    if (event.target !== stage) return;
    isPanning.value = true;
    const pointer = stage.getPointerPosition() ?? { x: 0, y: 0 };
    panStart = {
      x: pointer.x,
      y: pointer.y,
      panX: store.pan.x,
      panY: store.pan.y,
    };
    if (event.evt.button === 0) store.clearSelection();
  });
  stage.on('mousemove', () => {
    if (!isPanning.value) return;
    const pointer = stage.getPointerPosition() ?? { x: 0, y: 0 };
    store.pan = {
      x: panStart.panX + pointer.x - panStart.x,
      y: panStart.panY + pointer.y - panStart.y,
    };
    applyViewport();
  });
  stage.on('mouseup', () => {
    isPanning.value = false;
  });
  stage.on('mouseleave', () => {
    isPanning.value = false;
  });
  renderDiagram();
}

function applyViewport() {
  const stage = stageRef.value;
  if (!stage) return;
  stage.scale({ x: store.zoom, y: store.zoom });
  stage.position(store.pan);
  stage.batchDraw();
}

function renderDiagram() {
  const layer = contentLayerRef.value;
  if (!layer) return;
  layer.destroyChildren();
  renderGrid(layer);
  const connectorNodes = [...store.connectors].sort((a, b) => a.zIndex - b.zIndex);
  connectorNodes.forEach((connector) => layer.add(createConnectorNode(connector)));
  const diagramNodes = [...store.nodes].sort((a, b) => a.zIndex - b.zIndex);
  diagramNodes.forEach((node) => layer.add(createDiagramNode(node)));
  applyViewport();
  layer.batchDraw();
}

function renderGrid(layer: Konva.Layer) {
  const zoom = store.zoom;
  const step = store.gridSize * (zoom < 0.55 ? 4 : zoom < 0.85 ? 2 : 1);
  const left = -store.pan.x / zoom;
  const top = -store.pan.y / zoom;
  const right = left + viewport.value.width / zoom;
  const bottom = top + viewport.value.height / zoom;
  const gridGroup = new Konva.Group({ listening: false });
  for (let x = Math.floor(left / step) * step; x < right + step; x += step) {
    gridGroup.add(
      new Konva.Line({
        points: [x, top, x, bottom],
        stroke: x % (step * 5) === 0 ? '#d8e2ef' : '#eef2f7',
        strokeWidth: x % (step * 5) === 0 ? 1 : 0.7,
      }),
    );
  }
  for (let y = Math.floor(top / step) * step; y < bottom + step; y += step) {
    gridGroup.add(
      new Konva.Line({
        points: [left, y, right, y],
        stroke: y % (step * 5) === 0 ? '#d8e2ef' : '#eef2f7',
        strokeWidth: y % (step * 5) === 0 ? 1 : 0.7,
      }),
    );
  }
  layer.add(gridGroup);
}

function createDiagramNode(node: DiagramNode): Konva.Group {
  const group = new Konva.Group({
    id: node.id,
    name: 'diagram-node',
    x: node.x,
    y: node.y,
    draggable: !node.locked && store.toolMode === 'select',
  });
  const selected = store.selectedIds.includes(node.id);
  const isMultiSelected = selected && store.selectedIds.length > 1;
  const stroke = node.locked ? '#8b95a5' : selected ? '#1769ff' : '#9aabbf';

  if (node.kind === 'rectangle') {
    group.add(
      new Konva.Rect({
        width: node.width,
        height: node.height,
        fill: node.color,
        stroke,
        strokeWidth: selected ? 2.5 : 1.4,
        cornerRadius: 8,
        shadowColor: '#101828',
        shadowOpacity: selected ? 0.15 : 0.06,
        shadowBlur: selected ? 12 : 6,
        shadowOffsetY: 3,
      }),
    );
    group.add(createCenteredText(node.text, node.width, node.height));
  } else if (node.kind === 'circle') {
    group.add(
      new Konva.Circle({
        x: node.width / 2,
        y: node.height / 2,
        radius: Math.min(node.width, node.height) / 2,
        fill: node.color,
        stroke,
        strokeWidth: selected ? 2.5 : 1.4,
        shadowColor: '#101828',
        shadowOpacity: 0.08,
        shadowBlur: 8,
      }),
    );
    group.add(createCenteredText(node.text, node.width, node.height));
  } else if (node.kind === 'diamond') {
    group.add(
      new Konva.Line({
        points: [
          node.width / 2,
          0,
          node.width,
          node.height / 2,
          node.width / 2,
          node.height,
          0,
          node.height / 2,
        ],
        closed: true,
        fill: node.color,
        stroke,
        strokeWidth: selected ? 2.5 : 1.4,
        shadowColor: '#101828',
        shadowOpacity: 0.08,
        shadowBlur: 8,
      }),
    );
    group.add(createCenteredText(node.text, node.width, node.height, node.width * 0.62));
  } else {
    group.add(
      new Konva.Rect({
        width: node.width,
        height: node.height,
        fill: '#ffffff',
        stroke,
        strokeWidth: selected ? 2.5 : 1.4,
        cornerRadius: 7,
        shadowColor: '#101828',
        shadowOpacity: 0.08,
        shadowBlur: 8,
        shadowOffsetY: 3,
      }),
    );
    group.add(
      new Konva.Rect({
        width: node.width,
        height: 39,
        fill: '#eaf1ff',
        cornerRadius: [7, 7, 0, 0],
      }),
    );
    group.add(
      new Konva.Text({
        x: 13,
        y: 11,
        width: node.width - 26,
        text: node.text,
        fill: '#17335f',
        fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
        fontSize: 14,
        fontStyle: 'bold',
        ellipsis: true,
        wrap: 'none',
      }),
    );
    node.fields.forEach((field, index) => {
      const y = 48 + index * 34;
      if (y + 26 > node.height) return;
      group.add(
        new Konva.Line({
          points: [0, y + 27, node.width, y + 27],
          stroke: '#edf0f5',
          strokeWidth: 1,
        }),
      );
      group.add(
        new Konva.Text({
          x: 12,
          y,
          width: node.width - 24,
          text: field.text,
          fill: '#475467',
          fontFamily: 'SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          ellipsis: true,
          wrap: 'none',
        }),
      );
    });
  }

  // 修订链状态标记：另一页修改同一对象时旧预览失效（橙），确认冲突时并列两版（红）。
  const stateKind: 'conflict' | 'stale' | null = store.entityConflict('node', node.id)
    ? 'conflict'
    : store.entityStale('node', node.id)
      ? 'stale'
      : null;
  if (stateKind) {
    group.add(
      new Konva.Circle({
        x: node.width - 10,
        y: 10,
        radius: 6,
        fill: stateKind === 'conflict' ? '#d92d20' : '#f79009',
        stroke: '#ffffff',
        strokeWidth: 1.5,
        listening: false,
      }),
    );
  }

  if (node.locked) {
    group.add(
      new Konva.Text({
        x: node.width - 24,
        y: 9,
        text: 'L',
        fill: '#667085',
        fontFamily: 'Menlo, monospace',
        fontSize: 11,
        fontStyle: 'bold',
      }),
    );
  }

  group.on('click tap', (event) => {
    event.cancelBubble = true;
    store.selectNode(node.id, event.evt.shiftKey);
  });
  group.on('dragstart', (event) => {
    if (node.locked) return;
    event.cancelBubble = true;
    if (!store.selectedIds.includes(node.id)) store.selectNode(node.id);
    const groupIds = new Set(store.selectedIds);
    if (node.groupId) {
      store.nodes.filter((item) => item.groupId === node.groupId).forEach((item) => groupIds.add(item.id));
    }
    const ids = [...groupIds];
    // 一次拖拽产生一条修订；位置在 dragend 通过 commitPositions 统一提交。
    dragState = {
      ids,
      primaryId: node.id,
      startPositions: Object.fromEntries(
        store.nodes
          .filter((item) => ids.includes(item.id))
          .map((item) => [item.id, { x: item.x, y: item.y }]),
      ),
      moved: false,
    };
  });
  group.on('dragmove', (dragEvent) => {
    if (!dragState) return;
    const start = dragState.startPositions[dragState.primaryId];
    if (!start) return;
    let deltaX = group.x() - start.x;
    let deltaY = group.y() - start.y;
    const movingNodes = store.nodes.filter((item) => dragState?.ids.includes(item.id));
    if (store.snapToGrid && !(dragEvent.evt as MouseEvent).shiftKey) {
      const anchor = movingNodes.find((item) => item.id === dragState?.primaryId);
      if (anchor) {
        const snappedX = Math.round((start.x + deltaX) / store.gridSize) * store.gridSize;
        const snappedY = Math.round((start.y + deltaY) / store.gridSize) * store.gridSize;
        deltaX = snappedX - start.x;
        deltaY = snappedY - start.y;
      }
    }
    movingNodes.forEach((item) => {
      const position = dragState?.startPositions[item.id];
      if (!position) return;
      const nextX = position.x + deltaX;
      const nextY = position.y + deltaY;
      const child = group.getStage()?.findOne(`#${item.id}`) as Konva.Group | undefined;
      if (child) child.position({ x: nextX, y: nextY });
    });
    const previewNodes = store.nodes.map((item) => {
      const position = dragState?.startPositions[item.id];
      return position
        ? { ...item, x: position.x + deltaX, y: position.y + deltaY }
        : item;
    });
    const active = previewNodes.filter((item) => dragState?.ids.includes(item.id));
    renderGuides(calculateAlignmentGuides(active, previewNodes, 7 / store.zoom));
    dragState.moved = Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5;
  });
  group.on('dragend', () => {
    if (!dragState) return;
    const start = dragState.startPositions[dragState.primaryId];
    const current = group.position();
    const deltaX = current.x - start.x;
    const deltaY = current.y - start.y;
    const positions = Object.fromEntries(
      Object.entries(dragState.startPositions).map(([id, point]) => [
        id,
        { x: point.x + deltaX, y: point.y + deltaY },
      ]),
    );
    store.commitPositions(positions);
    dragState = null;
    clearGuides();
    void nextTick(renderDiagram);
  });

  if (isMultiSelected) {
    group.add(
      new Konva.Rect({
        x: -5,
        y: -5,
        width: node.width + 10,
        height: node.height + 10,
        stroke: '#84adff',
        strokeWidth: 1,
        dash: [5, 4],
        listening: false,
      }),
    );
  }
  if (selected && !node.locked && store.toolMode === 'connect') {
    (['top', 'right', 'bottom', 'left'] as AnchorSide[]).forEach((side) => {
      const point = localAnchorPoint(node, side);
      const anchor = new Konva.Circle({
        x: point.x,
        y: point.y,
        radius: 6 / store.zoom,
        fill: '#ffffff',
        stroke: '#1769ff',
        strokeWidth: 2 / store.zoom,
        draggable: true,
        name: 'connect-anchor',
      });
      anchor.on('dragstart', (event) => {
        event.cancelBubble = true;
        tempConnection.value = { start: anchorPoint(node, side), fromId: node.id };
        const line = new Konva.Line({
          name: 'temp-connection',
          points: [tempConnection.value.start.x, tempConnection.value.start.y],
          stroke: '#1769ff',
          strokeWidth: 2 / store.zoom,
          dash: [8 / store.zoom, 5 / store.zoom],
          listening: false,
        });
        guideLayerRef.value?.add(line);
      });
      anchor.on('dragmove', () => {
        if (!tempConnection.value) return;
        const pointer = pointerToWorld();
        const stage = stageRef.value;
        const target = stage
          ? store.nodes.find((item) => item.id !== node.id && pointInNode(pointer, item))
          : undefined;
        const line = guideLayerRef.value?.findOne('.temp-connection') as Konva.Line | undefined;
        line?.points([
          tempConnection.value.start.x,
          tempConnection.value.start.y,
          pointer.x,
          pointer.y,
        ]);
        line?.stroke(target ? '#12805c' : '#1769ff');
        guideLayerRef.value?.batchDraw();
      });
      anchor.on('dragend', () => {
        const pointer = pointerToWorld();
        const target = store.nodes.find((item) => item.id !== node.id && pointInNode(pointer, item));
        if (target) {
          const sideToTarget = nearestSide(pointer, target);
          store.addConnector(node.id, target.id, side, sideToTarget);
        }
        guideLayerRef.value?.findOne('.temp-connection')?.destroy();
        guideLayerRef.value?.batchDraw();
        tempConnection.value = null;
        void nextTick(renderDiagram);
      });
      group.add(anchor);
    });
  }

  return group;
}

function createCenteredText(text: string, width: number, height: number, maxWidth?: number) {
  return new Konva.Text({
    x: 10,
    y: height / 2 - 23,
    width: width - 20,
    height: 46,
    text,
    align: 'center',
    verticalAlign: 'middle',
    fill: '#24344d',
    fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    fontSize: 14,
    fontStyle: 'bold',
    wrap: 'word',
    ellipsis: true,
    ...(maxWidth ? { width: maxWidth, x: (width - maxWidth) / 2 } : {}),
  });
}

function createConnectorNode(connector: DiagramConnector): Konva.Group {
  const points = routeConnector(connector, store.nodes);
  const selected = store.selectedConnectorId === connector.id;
  const stateKind: 'conflict' | 'stale' | null = store.entityConflict('connector', connector.id)
    ? 'conflict'
    : store.entityStale('connector', connector.id)
      ? 'stale'
      : null;
  const group = new Konva.Group({ listening: true });
  const arrow = new Konva.Arrow({
    points,
    stroke: selected
      ? '#1769ff'
      : stateKind === 'conflict'
        ? '#d92d20'
        : stateKind === 'stale'
          ? '#b54708'
          : connector.color,
    fill: selected
      ? '#1769ff'
      : stateKind === 'conflict'
        ? '#d92d20'
        : stateKind === 'stale'
          ? '#b54708'
          : connector.color,
    strokeWidth: selected || stateKind ? 2.8 : 1.8,
    dash: connector.dashed ? [9, 6] : stateKind ? [12, 5] : undefined,
    pointerLength: 10,
    pointerWidth: 9,
    lineJoin: 'round',
    lineCap: 'round',
    hitStrokeWidth: 16,
  });
  group.add(arrow);
  if (connector.label && points.length >= 4) {
    const middle = points.length === 4
      ? { x: points[0], y: points[1] }
      : { x: points[points.length - 2], y: points[points.length - 1] };
    group.add(
      new Konva.Text({
        x: middle.x + 6,
        y: middle.y - 20,
        text: connector.label,
        fill: connector.color,
        fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
        fontSize: 11,
        fontStyle: 'bold',
        padding: 3,
      }),
    );
  }
  group.on('click tap', (event) => {
    event.cancelBubble = true;
    store.selectConnector(connector.id);
  });
  group.on('mouseenter', () => {
    stageRef.value?.container().style.setProperty('cursor', 'pointer');
  });
  group.on('mouseleave', () => {
    stageRef.value?.container().style.setProperty('cursor', 'default');
  });
  return group;
}

function renderGuides(guides: ReturnType<typeof calculateAlignmentGuides>) {
  const layer = guideLayerRef.value;
  if (!layer) return;
  layer.find('.alignment-guide').forEach((node) => node.destroy());
  guides.forEach((guide) => {
    const points =
      guide.orientation === 'vertical'
        ? [guide.position, guide.start, guide.position, guide.end]
        : [guide.start, guide.position, guide.end, guide.position];
    layer.add(
      new Konva.Line({
        name: 'alignment-guide',
        points,
        stroke: '#f79009',
        strokeWidth: 1 / store.zoom,
        dash: [6 / store.zoom, 4 / store.zoom],
        listening: false,
      }),
    );
    const labelX = guide.orientation === 'vertical' ? guide.position + 8 : (guide.start + guide.end) / 2;
    const labelY = guide.orientation === 'vertical' ? (guide.start + guide.end) / 2 : guide.position + 8;
    layer.add(
      new Konva.Label({
        name: 'alignment-guide',
        x: labelX,
        y: labelY,
        listening: false,
        opacity: 0.96,
      })
        .add(
          new Konva.Tag({
            fill: '#b54708',
            cornerRadius: 3,
            pointerDirection: 'down',
            pointerWidth: 5,
            pointerHeight: 5,
          }),
        )
        .add(
          new Konva.Text({
            text: guide.label,
            padding: 4,
            fill: '#ffffff',
            fontSize: 10 / store.zoom,
          }),
        ),
    );
  });
  layer.batchDraw();
}

function clearGuides() {
  const layer = guideLayerRef.value;
  if (!layer) return;
  layer.find('.alignment-guide').forEach((node) => node.destroy());
  layer.batchDraw();
}

function localAnchorPoint(node: DiagramNode, side: AnchorSide): Point {
  if (side === 'top') return { x: node.width / 2, y: 0 };
  if (side === 'right') return { x: node.width, y: node.height / 2 };
  if (side === 'bottom') return { x: node.width / 2, y: node.height };
  return { x: 0, y: node.height / 2 };
}

function pointerToWorld(): Point {
  const pointer = stageRef.value?.getPointerPosition() ?? { x: 0, y: 0 };
  return {
    x: (pointer.x - store.pan.x) / store.zoom,
    y: (pointer.y - store.pan.y) / store.zoom,
  };
}

function pointInNode(point: Point, node: DiagramNode): boolean {
  return (
    point.x >= node.x &&
    point.x <= node.x + node.width &&
    point.y >= node.y &&
    point.y <= node.y + node.height
  );
}

function nearestSide(point: Point, node: DiagramNode): AnchorSide {
  const distances: Array<[AnchorSide, number]> = [
    ['top', Math.abs(point.y - node.y)],
    ['right', Math.abs(point.x - (node.x + node.width))],
    ['bottom', Math.abs(point.y - (node.y + node.height))],
    ['left', Math.abs(point.x - node.x)],
  ];
  return distances.sort((left, right) => left[1] - right[1])[0][0];
}

function handleDrop(event: DragEvent) {
  event.preventDefault();
  const kind = event.dataTransfer?.getData('application/x-frameflow-node') as NodeKind | undefined;
  if (!kind) return;
  const container = containerRef.value;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  store.addNode(kind, {
    x: (event.clientX - rect.left - store.pan.x) / store.zoom - 80,
    y: (event.clientY - rect.top - store.pan.y) / store.zoom - 40,
  });
}

function zoomIn() {
  store.zoomBy(0.12);
  applyViewport();
}

function zoomOut() {
  store.zoomBy(-0.12);
  applyViewport();
}

function fit() {
  store.fitToView(viewport.value.width, viewport.value.height);
  applyViewport();
}

function exportSvg() {
  const stage = stageRef.value;
  if (!stage) return;
  const svg = (stage as unknown as { toSVG: () => string }).toSVG();
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${store.title}.svg`);
}

function exportJson() {
  // 导出沿用当前修订关系：完整 v2 文档（含修订链与各对象 rev）。
  const content = JSON.stringify(store.snapshot(), null, 2);
  downloadBlob(
    new Blob([content], { type: 'application/json;charset=utf-8' }),
    `${store.title || 'frameflow'}-r${store.headRev}.json`,
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function handleKeyboard(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.matches('input, textarea, [contenteditable="true"]')) return;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? store.redo() : store.undo();
    void nextTick(renderDiagram);
  } else if (command && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    store.redo();
    void nextTick(renderDiagram);
  } else if (command && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    store.duplicateSelection();
    void nextTick(renderDiagram);
  } else if (command && event.key.toLowerCase() === 'g') {
    event.preventDefault();
    event.shiftKey ? store.ungroupSelection() : store.groupSelection();
    void nextTick(renderDiagram);
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    store.deleteSelection();
    void nextTick(renderDiagram);
  } else if (event.key === 'Escape') {
    store.setToolMode('select');
    store.clearSelection();
    void nextTick(renderDiagram);
  } else if (event.key.startsWith('Arrow') && store.selectedIds.length) {
    event.preventDefault();
    const amount = store.snapToGrid ? store.gridSize : event.shiftKey ? 10 : 1;
    const delta = {
      ArrowLeft: { x: -amount, y: 0 },
      ArrowRight: { x: amount, y: 0 },
      ArrowUp: { x: 0, y: -amount },
      ArrowDown: { x: 0, y: amount },
    }[event.key];
    if (!delta) return;
    store.commitPositions(
      Object.fromEntries(
        store.selectedNodes.map((node) => [
          node.id,
          { x: node.x + delta.x, y: node.y + delta.y },
        ]),
      ),
      { label: '方向键移动图元' },
    );
    void nextTick(renderDiagram);
  }
}

onMounted(() => {
  initializeStage();
  resizeObserver = new ResizeObserver(([entry]) => {
    viewport.value = { width: entry.contentRect.width, height: entry.contentRect.height };
    stageRef.value?.size(viewport.value);
    renderDiagram();
  });
  if (containerRef.value) resizeObserver.observe(containerRef.value);
  window.addEventListener('keydown', handleKeyboard);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  stageRef.value?.destroy();
  window.removeEventListener('keydown', handleKeyboard);
});

watch(
  () => [
    store.nodes,
    store.connectors,
    store.groups,
    store.selectedIds,
    store.selectedConnectorId,
    store.toolMode,
    store.staleKeys,
    store.conflictKeys,
  ],
  () => void nextTick(renderDiagram),
  { deep: true },
);
watch(
  () => [store.zoom, store.pan.x, store.pan.y],
  () => applyViewport(),
);
</script>

<template>
  <section
    ref="containerRef"
    class="diagram-canvas"
    @dragover.prevent
    @drop="handleDrop"
  >
    <div ref="stageHostRef" class="stage-host" />
    <div class="canvas-toolbar">
      <button type="button" title="缩小" @click="zoomOut">−</button>
      <span>{{ zoomPercent }}</span>
      <button type="button" title="放大" @click="zoomIn">＋</button>
      <button type="button" class="fit-button" title="适应画布" @click="fit">适应</button>
    </div>
    <div class="canvas-hint">
      <span v-if="store.toolMode === 'connect'" class="hint-active">
        连线模式：拖动节点边缘蓝色锚点完成连接
      </span>
      <span v-else>选择模式 · 拖动图元查看对齐参考线</span>
    </div>
    <MiniMap />
    <div class="canvas-actions">
      <el-button size="small" @click="exportJson">导出 JSON</el-button>
      <el-button size="small" @click="exportSvg">导出 SVG</el-button>
    </div>
  </section>
</template>
