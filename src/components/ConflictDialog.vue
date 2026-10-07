<script setup lang="ts">
import { computed } from 'vue';
import { CircleCheck, Warning } from '@element-plus/icons-vue';
import type {
  DiagramConnector,
  DiagramNode,
  EntityKind,
  MergeConflict,
  RevisionEntity,
} from '../types/diagram';
import { useDiagramStore } from '../stores/diagram';

const store = useDiagramStore();

const pending = computed(() => store.pendingMerge);
const dialogVisible = computed({
  get: () => Boolean(store.pendingMerge),
  set: (value) => {
    if (!value) store.cancelPendingMerge();
  },
});

const dialogTitle = computed(() => {
  if (!pending.value) return '';
  const action = pending.value.source === 'import' ? '导入文件与本页改动冲突' : '另一标签页修改了同一对象';
  return `${action} · 并列两版`;
});

function isNode(entity: RevisionEntity | null): entity is DiagramNode {
  return Boolean(entity && 'kind' in entity);
}

function asNode(entity: RevisionEntity | null): DiagramNode | null {
  return isNode(entity) ? entity : null;
}

function asConnector(entity: RevisionEntity | null): DiagramConnector | null {
  return entity && !('kind' in entity) && 'fromId' in entity ? (entity as DiagramConnector) : null;
}

function kindName(kind: EntityKind | 'title'): string {
  return { node: '图元', connector: '连接线', group: '分组', title: '标题' }[kind];
}

function entitySummary(entity: RevisionEntity | null): Array<{ key: string; value: string }> {
  if (!entity) return [{ key: '状态', value: '（此版本中已删除）' }];
  const node = asNode(entity);
  if (node) {
    const rows = [
      { key: '名称', value: node.text || '未命名' },
      { key: '位置', value: `${Math.round(node.x)}, ${Math.round(node.y)}` },
      { key: '尺寸', value: `${Math.round(node.width)} × ${Math.round(node.height)}` },
      { key: '填充', value: node.color },
      { key: '锁定', value: node.locked ? '是' : '否' },
    ];
    if (node.kind === 'table') {
      rows.push({
        key: `字段 (${node.fields.length})`,
        value: node.fields.map((field) => field.text).join('\n') || '（无字段）',
      });
    }
    rows.push({ key: '修订号', value: `r${entity.rev}` });
    return rows;
  }
  const connector = asConnector(entity);
  if (connector) {
    return [
      { key: '标签', value: connector.label || '（无）' },
      { key: '起止', value: `${connector.fromId} → ${connector.toId}` },
      { key: '锚点', value: `${connector.fromAnchor} → ${connector.toAnchor}` },
      { key: '颜色', value: connector.color },
      { key: '虚线', value: connector.dashed ? '是' : '否' },
      { key: '修订号', value: `r${entity.rev}` },
    ];
  }
  return [
    { key: '名称', value: String((entity as { name?: string }).name ?? '分组') },
    { key: '修订号', value: `r${entity.rev}` },
  ];
}

function titleText(conflict: MergeConflict, side: 'base' | 'local' | 'remote'): string {
  if (side === 'base') return conflict.baseTitle ?? '';
  if (side === 'local') return conflict.localTitle ?? '';
  return conflict.remoteTitle ?? '';
}

function choose(conflict: MergeConflict, choice: 'local' | 'remote') {
  conflict.choice = choice;
}

const choices = computed(() =>
  (pending.value?.conflicts ?? []).map((conflict) => ({
    id: conflict.id,
    kind: conflict.kind,
    choice: conflict.choice,
  })),
);

function confirm() {
  if (!pending.value) return;
  store.resolvePendingMerge(choices.value);
}

function takeAll(choice: 'local' | 'remote') {
  store.resolveAll(choice);
}

const conflictCount = computed(() => pending.value?.conflicts.length ?? 0);
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="dialogTitle"
    width="860px"
    top="6vh"
    :close-on-click-modal="false"
    class="conflict-dialog"
  >
    <div v-if="pending" class="conflict-body">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        :icon="Warning"
        class="conflict-alert"
      >
        <template #title>
          检测到 {{ conflictCount }} 处同对象修订冲突；另有
          <strong>{{ pending.autoChangeCount }}</strong>
          项不冲突改动将自动并入。确认前画布保持不变。
        </template>
        <div class="conflict-source">
          来源：{{ pending.sourceLabel }}（对方修订头 r{{ pending.remoteHeadRev }}，本页基线 r{{ pending.base.headRev }}）
        </div>
      </el-alert>

      <div class="conflict-list">
        <div v-for="conflict in pending.conflicts" :key="`${conflict.kind}-${conflict.id}`" class="conflict-card">
          <div class="conflict-card__head">
            <el-tag size="small" type="info">{{ kindName(conflict.kind) }}</el-tag>
            <strong>{{ conflict.label }}</strong>
            <code>{{ conflict.id }}</code>
          </div>

          <template v-if="conflict.kind === 'title'">
            <div class="version-grid">
              <button
                type="button"
                class="version-panel"
                :class="{ active: conflict.choice === 'local' }"
                @click="choose(conflict, 'local')"
              >
                <div class="version-panel__head">
                  <el-icon><CircleCheck v-if="conflict.choice === 'local'" /></el-icon>
                  <span>本页版本</span>
                </div>
                <pre>{{ titleText(conflict, 'local') || '（空标题）' }}</pre>
              </button>
              <button
                type="button"
                class="version-panel version-panel--remote"
                :class="{ active: conflict.choice === 'remote' }"
                @click="choose(conflict, 'remote')"
              >
                <div class="version-panel__head">
                  <el-icon><CircleCheck v-if="conflict.choice === 'remote'" /></el-icon>
                  <span>另一版本</span>
                </div>
                <pre>{{ titleText(conflict, 'remote') || '（空标题）' }}</pre>
              </button>
            </div>
          </template>

          <template v-else>
            <div class="version-grid">
              <button
                type="button"
                class="version-panel"
                :class="{ active: conflict.choice === 'local' }"
                @click="choose(conflict, 'local')"
              >
                <div class="version-panel__head">
                  <el-icon><CircleCheck v-if="conflict.choice === 'local'" /></el-icon>
                  <span>本页版本{{ conflict.local ? ` · r${conflict.local.rev}` : '' }}</span>
                </div>
                <dl>
                  <template v-for="row in entitySummary(conflict.local)" :key="row.key">
                    <dt>{{ row.key }}</dt>
                    <dd><pre>{{ row.value }}</pre></dd>
                  </template>
                </dl>
              </button>
              <button
                type="button"
                class="version-panel version-panel--remote"
                :class="{ active: conflict.choice === 'remote' }"
                @click="choose(conflict, 'remote')"
              >
                <div class="version-panel__head">
                  <el-icon><CircleCheck v-if="conflict.choice === 'remote'" /></el-icon>
                  <span>另一版本{{ conflict.remote ? ` · r${conflict.remote.rev}` : '' }}</span>
                </div>
                <dl>
                  <template v-for="row in entitySummary(conflict.remote)" :key="row.key">
                    <dt>{{ row.key }}</dt>
                    <dd><pre>{{ row.value }}</pre></dd>
                  </template>
                </dl>
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="conflict-footer">
        <el-button @click="takeAll('local')">全部保留本页</el-button>
        <el-button @click="takeAll('remote')">全部采用另一版</el-button>
        <span class="conflict-footer__spacer" />
        <el-button @click="dialogVisible = false">暂不处理</el-button>
        <el-button type="primary" @click="confirm">确认合并</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.conflict-alert {
  margin-bottom: 14px;
}
.conflict-source {
  font-size: 12px;
  color: #667085;
  margin-top: 4px;
}
.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 54vh;
  overflow-y: auto;
  padding-right: 4px;
}
.conflict-card {
  border: 1px solid #e4e9f2;
  border-radius: 10px;
  padding: 12px;
  background: #fbfcfe;
}
.conflict-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.conflict-card__head code {
  font-size: 11px;
  color: #98a2b3;
  background: #f2f4f7;
  padding: 1px 6px;
  border-radius: 4px;
}
.version-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.version-panel {
  text-align: left;
  border: 2px solid #e4e9f2;
  border-radius: 8px;
  background: #fff;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  font: inherit;
}
.version-panel:hover {
  border-color: #9db8f7;
}
.version-panel.active {
  border-color: #1769ff;
  box-shadow: 0 0 0 2px rgba(23, 105, 255, 0.15);
}
.version-panel--remote {
  background: #fffbef;
}
.version-panel--remote.active {
  border-color: #b54708;
  box-shadow: 0 0 0 2px rgba(181, 71, 8, 0.15);
}
.version-panel__head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
  color: #344054;
  margin-bottom: 6px;
}
.version-panel dl {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 3px 8px;
  margin: 0;
  font-size: 12px;
}
.version-panel dt {
  color: #98a2b3;
}
.version-panel dd {
  margin: 0;
  color: #344054;
}
.version-panel pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: SFMono-Regular, Menlo, monospace;
}
.conflict-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.conflict-footer__spacer {
  flex: 1;
}
</style>
