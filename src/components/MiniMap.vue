<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useDiagramStore } from '../stores/diagram';

const store = useDiagramStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const width = 214;
const height = 118;

const bounds = computed(() => {
  const nodes = store.nodes;
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 700 };
  const minX = Math.min(...nodes.map((node) => node.x)) - 50;
  const minY = Math.min(...nodes.map((node) => node.y)) - 50;
  const maxX = Math.max(...nodes.map((node) => node.x + node.width)) + 50;
  const maxY = Math.max(...nodes.map((node) => node.y + node.height)) + 50;
  return { minX, minY, maxX: Math.max(maxX, minX + 500), maxY: Math.max(maxY, minY + 360) };
});

function getTransform() {
  const worldWidth = bounds.value.maxX - bounds.value.minX;
  const worldHeight = bounds.value.maxY - bounds.value.minY;
  const scale = Math.min(width / worldWidth, height / worldHeight);
  return {
    scale,
    x: (width - worldWidth * scale) / 2,
    y: (height - worldHeight * scale) / 2,
  };
}

function toScreen(x: number, y: number) {
  const transform = getTransform();
  return {
    x: (x - bounds.value.minX) * transform.scale + transform.x,
    y: (y - bounds.value.minY) * transform.scale + transform.y,
  };
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#f7f9fc';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#dce3ed';
  context.lineWidth = 1;
  for (let x = 0; x < width; x += 18) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += 18) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  store.connectors.forEach((connector) => {
    const from = store.nodes.find((node) => node.id === connector.fromId);
    const to = store.nodes.find((node) => node.id === connector.toId);
    if (!from || !to) return;
    const start = toScreen(from.x + from.width / 2, from.y + from.height / 2);
    const end = toScreen(to.x + to.width / 2, to.y + to.height / 2);
    context.strokeStyle = connector.color;
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  });

  store.nodes.forEach((node) => {
    const point = toScreen(node.x, node.y);
    const transform = getTransform();
    context.fillStyle = node.color;
    context.strokeStyle = store.selectedIds.includes(node.id) ? '#1769ff' : '#8b9bb3';
    context.lineWidth = store.selectedIds.includes(node.id) ? 2 : 1;
    context.beginPath();
    context.roundRect(
      point.x,
      point.y,
      Math.max(4, node.width * transform.scale),
      Math.max(4, node.height * transform.scale),
      3,
    );
    context.fill();
    context.stroke();
  });
}

watch(
  () => [store.nodes, store.connectors, store.selectedIds],
  () => void nextTick(draw),
  { deep: true },
);

onMounted(draw);
</script>

<template>
  <div class="mini-map">
    <div class="mini-map__head">
      <strong>缩略图</strong>
      <span>{{ Math.round(store.zoom * 100) }}%</span>
    </div>
    <canvas ref="canvasRef" />
  </div>
</template>
