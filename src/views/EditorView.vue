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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ConflictDialog from '../components/ConflictDialog.vue';
import DiagramCanvas from '../components/DiagramCanvas.vue';
import PropertiesPanel from '../components/PropertiesPanel.vue';
import ShapePalette from '../components/ShapePalette.vue';
import { useDiagramStore } from '../stores/diagram';

const store = useDiagramStore();
const importInput = ref<HTMLInputElement | null>(null);
const titleDraft = ref(store.title);

watch(
  () => store.title,
  (value) => {
    titleDraft.value = value;
  },
);

const syncMeta = computed(() => {
  switch (store.syncState) {
    case 'synced':
      return { text: store.syncMessage || `已同步 r${store.headRev}`, tone: 'status-online' };
    case 'ahead':
      return { text: `本页有未提交修订（r${store.headRev} → 本地 r${store.localSeq}）`, tone: 'status-ahead' };
    case 'remote-ahead':
      return { text: '另一标签页有新版本，待确认合并', tone: 'status-remote' };
    case 'conflict':
      return { text: '存在同对象冲突，等待并列两版处理', tone: 'status-conflict' };
    case 'recovered-stable':
      return { text: '已从最后稳定版本恢复', tone: 'status-remote' };
    case 'recovered-staging':
      return { text: '已从暂存草稿恢复', tone: 'status-remote' };
    default:
      return { text: '本地草稿已启用', tone: 'status-online' };
  }
});

function commitTitle() {
  const next = titleDraft.value.trim() || '未命名图表';
  titleDraft.value = next;
  if (next !== store.title) store.setTitle(next);
}

function saveNow() {
  const result = store.flushPersist();
  if (result.ok) {
    ElMessage.success('本页改动已作为增量修订提交到本机草稿');
  } else if (result.reason === 'conflict') {
    ElMessage.warning('另一标签页修改了同一对象，请在并列两版窗口中确认');
  } else {
    ElMessage.error(`保存失败：${result.reason ?? '未知错误'}（已尝试从稳定版本恢复）`);
  }
}

function openImport() {
  importInput.value?.click();
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const content = await file.text();
    const result = store.importJson(content, file.name);
    if (!result.ok) {
      ElMessage.error(result.error ?? '导入失败');
    } else if (result.pending) {
      ElMessage.warning('导入文件与本页改动有分叉，请在并列两版窗口中确认；当前画布未改动');
    } else {
      ElMessage.success(`已导入 ${file.name}`);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入失败，当前画布未改动');
  } finally {
    input.value = '';
  }
}

function run(action: () => void, message?: string) {
  action();
  if (message) ElMessage.success(message);
  void nextTick();
}

onMounted(() => {
  store.bindStorageSync();
  if (store.syncMessage) ElMessage.info(store.syncMessage);
});

onBeforeUnmount(() => {
  store.teardownStorageSync();
});
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
        <el-input
          v-model="titleDraft"
          class="title-input"
          @change="commitTitle"
          @blur="commitTitle"
        />
        <span class="save-state">
          <Finished /> r{{ store.headRev }}
        </span>
      </div>
      <div class="header-actions">
        <router-link class="guide-link" to="/guide">快捷键说明</router-link>
        <el-button :icon="Upload" @click="openImport">导入 JSON</el-button>
        <el-button type="primary" :icon="Download" @click="saveNow">保存本页改动</el-button>
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
        <el-tooltip content="撤销 Ctrl/Cmd + Z（生成反向修订）">
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
      <span>分组 {{ store.groups.length }} 个</span>
      <span>选择 {{ store.selectedIds.length }} 项</span>
      <span class="status-spacer" />
      <span>缩放 {{ Math.round(store.zoom * 100) }}%</span>
      <span>网格 {{ store.gridSize }} px</span>
      <span class="revision-state" :class="syncMeta.tone">
        <i /> {{ syncMeta.text }}
      </span>
    </footer>

    <ConflictDialog />
  </div>
</template>
