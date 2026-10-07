<script setup lang="ts">
import { computed } from 'vue';
import { useDiagramStore } from '../stores/diagram';
import { diffItem } from '../utils/revisions';
import type { ConflictItem } from '../types/diagram';

const store = useDiagramStore();

const dialogVisible = computed({
  get: () => store.conflicts !== null && store.conflicts.items.length > 0,
  set: (value) => {
    if (!value) store.resolveAll('local');
  },
});

const rows = computed(() =>
  (store.conflicts?.items ?? []).map((item) => ({
    item,
    diffs: diffItem(item),
  })),
);

function choose(item: ConflictItem, choice: 'local' | 'remote') {
  item.choice = choice;
}

function resolveAll(which: 'local' | 'remote') {
  store.resolveAll(which);
}

function confirm() {
  store.resolveConflict();
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="检测到其他标签页的修改"
    width="760px"
    :close-on-click-modal="false"
    append-to-body
  >
    <div class="conflict-intro">
      另一标签页也改动了同一对象。为避免整份覆盖，当前图保持不变，请在并列两版中逐对象选择保留哪一版。
    </div>

    <div class="conflict-list">
      <div v-for="{ item, diffs } in rows" :key="`${item.kind}-${item.id}`" class="conflict-card">
        <div class="conflict-card__head">
          <strong>{{ item.label }}</strong>
          <span class="conflict-kind">{{ item.kind === 'node' ? '节点' : item.kind === 'connector' ? '连线' : item.kind === 'group' ? '分组' : '标题' }}</span>
        </div>
        <div class="conflict-columns">
          <label
            class="conflict-column"
            :class="{ 'is-active': item.choice === 'local' }"
          >
            <input
              type="radio"
              :checked="item.choice === 'local'"
              @change="choose(item, 'local')"
            >
            <span class="column-title">本机版</span>
            <span class="column-values">
              <span v-for="diff in diffs" :key="`local-${diff.field}`" class="diff-row">
                <em>{{ diff.label }}</em>
                <code>{{ diff.local }}</code>
              </span>
            </span>
          </label>
          <label
            class="conflict-column"
            :class="{ 'is-active': item.choice === 'remote' }"
          >
            <input
              type="radio"
              :checked="item.choice === 'remote'"
              @change="choose(item, 'remote')"
            >
            <span class="column-title">远端版</span>
            <span class="column-values">
              <span v-for="diff in diffs" :key="`remote-${diff.field}`" class="diff-row">
                <em>{{ diff.label }}</em>
                <code>{{ diff.remote }}</code>
              </span>
            </span>
          </label>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="conflict-footer">
        <el-button @click="resolveAll('local')">全部保留本机</el-button>
        <el-button @click="resolveAll('remote')">全部采用远端</el-button>
        <el-button type="primary" @click="confirm">确认合并</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.conflict-intro {
  margin-bottom: 14px;
  padding: 10px 12px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  color: #9a3412;
  font-size: 13px;
  line-height: 1.6;
}

.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 56vh;
  overflow-y: auto;
  padding-right: 4px;
}

.conflict-card {
  border: 1px solid #e4e7ec;
  border-radius: 10px;
  overflow: hidden;
}

.conflict-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #eef2f7;
}

.conflict-kind {
  font-size: 12px;
  color: #667085;
}

.conflict-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}

.conflict-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  cursor: pointer;
  border: 2px solid transparent;
}

.conflict-column:first-child {
  border-right: 1px solid #eef2f7;
}

.conflict-column.is-active {
  background: #f0f7ff;
  border-color: #1769ff;
}

.column-title {
  font-size: 13px;
  font-weight: 600;
  color: #344054;
}

.column-values {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.diff-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.diff-row em {
  font-style: normal;
  font-size: 11px;
  color: #98a2b3;
}

.diff-row code {
  font-family: 'SFMono-Regular', Menlo, monospace;
  font-size: 12px;
  color: #1d2939;
  word-break: break-all;
}

.conflict-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
