<script setup lang="ts">
import {
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
  Warning,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { nextTick, onMounted, ref, watch } from 'vue';
import DiagramCanvas from '../components/DiagramCanvas.vue';
import ConflictDialog from '../components/ConflictDialog.vue';
import PropertiesPanel from '../components/PropertiesPanel.vue';
import ShapePalette from '../components/ShapePalette.vue';
import { useDiagramStore } from '../stores/diagram';
import { migrateDoc } from '../utils/revisions';

const store = useDiagramStore();
const importInput = ref<HTMLInputElement | null>(null);

onMounted(() => {
  store.startSync();
  if (store.recoveredFromCrash) {
    ElMessage.warning('上次保存中断，已从最后稳定版本恢复，正在重试保存…');
    void store.saveNow();
  }
});

// 自动并入其他标签页的非冲突改动后提示。
watch(
  () => store.lastAutoMerged,
  (count) => {
    if (count > 0) {
      ElMessage.success(`已同步其他标签页的 ${count} 处改动`);
      store.lastAutoMerged = 0;
    }
  },
);

function saveNow() {
  void store.saveNow();
}

function openImport() {
  importInput.value?.click();
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const migrated = migrateDoc(raw);
    if (!migrated.ok) {
      ElMessage.error(`导入失败：${migrated.error}`);
      return;
    }
    // 导入走与远端相同的三方合并：冲突进预览，不覆盖当前图。
    store.applyRemote(migrated.doc);
    if (store.conflictCount > 0) {
      ElMessage.warning('导入文件与当前编辑存在冲突，请在并列两版中确认');
    } else {
      ElMessage.success(`已导入 ${file.name}`);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入失败，当前图表未受影响');
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
        <el-input
          :model-value="store.title"
          class="title-input"
          @change="(value: unknown) => store.setTitle(String(value))"
        />
        <span class="save-state">
          <Finished v-if="store.saveState === 'saved'" />
          <Warning v-else-if="store.saveState === 'error'" class="save-state--error" />
          {{ store.saveState === 'saving' ? '保存中…' : store.saveState === 'error' ? '保存失败' : '已自动保存' }}
        </span>
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
      <span v-if="store.groups.length">分组 {{ store.groups.length }}</span>
      <span class="status-spacer" />
      <span>缩放 {{ Math.round(store.zoom * 100) }}%</span>
      <span>网格 {{ store.gridSize }} px</span>
      <span class="status-online"><i /> 修订草稿已启用</span>
    </footer>

    <ConflictDialog />
  </div>
</template>
