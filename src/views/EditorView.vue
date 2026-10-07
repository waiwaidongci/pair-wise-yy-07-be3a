<script setup lang="ts">
import {
  Back,
  Bottom,
  Connection,
  CopyDocument,
  Delete,
  Document,
  Download,
  Finished,
  Grid,
  Lock,
  Rank,
  RefreshLeft,
  RefreshRight,
  Top,
  Unlock,
  Upload,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { nextTick, ref } from 'vue';
import DiagramCanvas from '../components/DiagramCanvas.vue';
import PropertiesPanel from '../components/PropertiesPanel.vue';
import ShapePalette from '../components/ShapePalette.vue';
import { useDiagramStore } from '../stores/diagram';
import type { DiagramDocument } from '../types/diagram';

const store = useDiagramStore();
const importInput = ref<HTMLInputElement | null>(null);

function saveNow() {
  store.persistSoon();
  ElMessage.success('图表已保存到本机浏览器');
}

function openImport() {
  importInput.value?.click();
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const document = JSON.parse(await file.text()) as DiagramDocument;
    if (document.version !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.connectors)) {
      throw new Error('文件结构不符合 FrameFlow v1 格式');
    }
    store.importDocument(document);
    ElMessage.success(`已导入 ${file.name}`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入失败');
  } finally {
    input.value = '';
  }
}

function run(action: () => void, message?: string) {
  action();
  if (message) ElMessage.success(message);
  void nextTick();
}
</script>

<template>
  <div class="editor-shell">
    <header class="editor-header">
      <div class="editor-brand">
        <span class="brand-mark"><Grid /></span>
        <div>
          <strong>FrameFlow</strong>
          <small>流程与数据模型工作台</small>
        </div>
      </div>
      <div class="document-title">
        <el-input v-model="store.title" class="title-input" @change="store.persistSoon()" />
        <span class="save-state"><Finished /> 已自动保存</span>
      </div>
      <div class="header-actions">
        <router-link class="guide-link" to="/guide">快捷键说明</router-link>
        <el-button :icon="Upload" @click="openImport">导入 JSON</el-button>
        <el-button type="primary" :icon="Download" @click="saveNow">保存</el-button>
        <input
          ref="importInput"
          class="hidden-input"
          type="file"
          accept="application/json,.json"
          @change="importFile"
        >
      </div>
    </header>

    <section class="editor-toolbar">
      <div class="tool-group">
        <el-tooltip content="撤销 Ctrl/Cmd + Z">
          <el-button
            :icon="RefreshLeft"
            :disabled="!store.canUndo"
            @click="run(() => store.undo())"
          />
        </el-tooltip>
        <el-tooltip content="重做 Ctrl/Cmd + Shift + Z">
          <el-button
            :icon="RefreshRight"
            :disabled="!store.canRedo"
            @click="run(() => store.redo())"
          />
        </el-tooltip>
      </div>
      <span class="toolbar-divider" />
      <div class="tool-group">
        <el-button
          :type="store.toolMode === 'select' ? 'primary' : 'default'"
          :icon="Rank"
          @click="store.setToolMode('select')"
        >
          选择
        </el-button>
        <el-button
          :type="store.toolMode === 'connect' ? 'primary' : 'default'"
          :icon="Connection"
          @click="store.setToolMode('connect')"
        >
          连线
        </el-button>
      </div>
      <span class="toolbar-divider" />
      <div class="tool-group">
        <el-button :icon="CopyDocument" @click="run(() => store.duplicateSelection(), '已复制所选图元')">
          复制
        </el-button>
        <el-button
          :icon="store.activeNode?.locked ? Unlock : Lock"
          @click="run(() => store.toggleLock())"
        >
          {{ store.activeNode?.locked ? '解锁' : '锁定' }}
        </el-button>
        <el-dropdown trigger="click">
          <el-button :icon="Rank">层级</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item :icon="Top" @click="run(() => store.changeLayer('front'))">
                移到顶层
              </el-dropdown-item>
              <el-dropdown-item :icon="Bottom" @click="run(() => store.changeLayer('back'))">
                移到底层
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <span class="toolbar-divider" />
      <div class="tool-group">
        <el-button @click="run(() => store.groupSelection(), '已分组')">分组</el-button>
        <el-button @click="run(() => store.ungroupSelection(), '已取消分组')">取消分组</el-button>
      </div>
      <span class="toolbar-spacer" />
      <el-button
        type="danger"
        plain
        :icon="Delete"
        :disabled="!store.selectedIds.length && !store.selectedConnectorId"
        @click="run(() => store.deleteSelection())"
      >
        删除
      </el-button>
    </section>

    <main class="editor-workspace">
      <ShapePalette />
      <DiagramCanvas />
      <PropertiesPanel />
    </main>

    <footer class="editor-status">
      <span><Document /> {{ store.nodes.length }} 个图元</span>
      <span><Connection /> {{ store.connectors.length }} 条连接</span>
      <span>选择 {{ store.selectedIds.length }} 项</span>
      <span class="status-spacer" />
      <span>缩放 {{ Math.round(store.zoom * 100) }}%</span>
      <span>网格 {{ store.gridSize }} px</span>
      <span class="status-online"><i /> 本地草稿已启用</span>
    </footer>
  </div>
</template>
