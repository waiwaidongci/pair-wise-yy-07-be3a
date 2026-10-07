<script setup lang="ts">
import {
  Aim,
  CircleClose,
  Connection,
  DataLine,
  Grid,
  Menu,
  Plus,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { NodeKind } from '../types/diagram';
import { useDiagramStore } from '../stores/diagram';
import { makeId } from '../utils/revision';

const store = useDiagramStore();

const items: Array<{
  kind: NodeKind;
  title: string;
  description: string;
  icon: typeof Grid;
  previewClass: string;
}> = [
  {
    kind: 'rectangle',
    title: '流程节点',
    description: '业务动作或处理步骤',
    icon: Menu,
    previewClass: 'preview-rectangle',
  },
  {
    kind: 'circle',
    title: '开始 / 结束',
    description: '圆形流程端点',
    icon: CircleClose,
    previewClass: 'preview-circle',
  },
  {
    kind: 'diamond',
    title: '条件判断',
    description: '分支决策节点',
    icon: Aim,
    previewClass: 'preview-diamond',
  },
  {
    kind: 'table',
    title: '数据库表',
    description: '实体字段和主外键',
    icon: DataLine,
    previewClass: 'preview-table',
  },
];

function startDrag(event: DragEvent, kind: NodeKind) {
  event.dataTransfer?.setData('application/x-frameflow-node', kind);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}

function add(kind: NodeKind) {
  store.addNode(kind);
  ElMessage.success('已添加图元，可拖动调整位置');
}

function addGroup() {
  if (store.selectedIds.length < 2) {
    ElMessage.warning('请先按住 Shift 选择至少两个图元');
    return;
  }
  store.groupSelection();
  ElMessage.success('所选图元已分组');
}

function addTableField(): void {
  if (!store.activeNode || store.activeNode.kind !== 'table') {
    ElMessage.warning('请先选择数据库表节点');
    return;
  }
  store.patchNode(store.activeNode.id, {
    fields: [...store.activeNode.fields, { id: makeId('field'), text: 'new_column  VARCHAR(80)' }],
    height: store.activeNode.height + 34,
  });
}
</script>

<template>
  <aside class="shape-palette">
    <div class="panel-title">
      <strong>图元库</strong>
      <span>拖入画布或单击添加</span>
    </div>
    <div class="palette-grid">
      <button
        v-for="item in items"
        :key="item.kind"
        class="shape-card"
        draggable="true"
        type="button"
        @click="add(item.kind)"
        @dragstart="startDrag($event, item.kind)"
      >
        <span class="shape-preview" :class="item.previewClass">
          <component :is="item.icon" />
        </span>
        <span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.description }}</small>
        </span>
        <Plus class="shape-card__plus" />
      </button>
    </div>

    <div class="palette-section">
      <div class="section-label">快速结构</div>
      <el-button class="full-button" :icon="Connection" @click="addGroup">组合所选图元</el-button>
      <el-button class="full-button" :icon="DataLine" @click="addTableField">为表增加字段</el-button>
    </div>

    <div class="palette-section">
      <div class="section-label">画布偏好</div>
      <el-switch
        v-model="store.snapToGrid"
        inline-prompt
        active-text="吸附"
        inactive-text="自由"
      />
      <span class="preference-note">网格 {{ store.gridSize }} px</span>
    </div>

    <div class="shortcut-card">
      <strong>快捷操作</strong>
      <span><kbd>Shift</kbd> 多选 · <kbd>Ctrl G</kbd> 分组</span>
      <span><kbd>Ctrl D</kbd> 复制 · <kbd>Del</kbd> 删除</span>
      <span><kbd>Space</kbd> 拖动画布 · 滚轮缩放</span>
    </div>
  </aside>
</template>
