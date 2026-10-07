<script setup lang="ts">
import { Back, Connection, Grid, Rank } from '@element-plus/icons-vue';
</script>

<template>
  <div class="guide-page">
    <header>
      <div>
        <span class="brand-mark"><Grid /></span>
        <div>
          <h1>FrameFlow 使用说明</h1>
          <p>流程图、ERD 和架构图的本地编辑工作台</p>
        </div>
      </div>
      <router-link to="/">
        <el-button :icon="Back">返回编辑器</el-button>
      </router-link>
    </header>
    <main>
      <section>
        <h2>画布操作</h2>
        <div class="guide-grid">
          <article>
            <Rank />
            <h3>选择与移动</h3>
            <p>单击选择图元，按住 Shift 多选。拖动时显示橙色对齐参考线与实时距离。</p>
          </article>
          <article>
            <Connection />
            <h3>锚点连线</h3>
            <p>切换到连线模式，选中节点后拖动四周锚点到目标节点，系统会自动选择目标锚点并绕开遮挡。</p>
          </article>
          <article>
            <Grid />
            <h3>画布导航</h3>
            <p>滚轮围绕指针缩放，拖动画布空白区域平移。点击“适应”可让全部图元回到可视区。</p>
          </article>
        </div>
      </section>
      <section>
        <h2>快捷键</h2>
        <div class="shortcut-table">
          <span><kbd>Ctrl/Cmd + Z</kbd><em>撤销</em></span>
          <span><kbd>Ctrl/Cmd + Shift + Z</kbd><em>重做</em></span>
          <span><kbd>Ctrl/Cmd + D</kbd><em>复制选中图元</em></span>
          <span><kbd>Ctrl/Cmd + G</kbd><em>组合选中图元</em></span>
          <span><kbd>Ctrl/Cmd + Shift + G</kbd><em>取消组合</em></span>
          <span><kbd>Delete / Backspace</kbd><em>删除所选对象</em></span>
          <span><kbd>方向键</kbd><em>按网格移动</em></span>
          <span><kbd>Shift + 方向键</kbd><em>精细移动</em></span>
          <span><kbd>Esc</kbd><em>返回选择模式并清除选择</em></span>
        </div>
      </section>
      <section>
        <h2>保存、修订链与多标签页</h2>
        <p>
          每个节点、字段、连接线和分组都带有稳定身份与修订号，编辑会沿修订链增量提交：
          点「保存本页改动」只提交本页变化的对象，不再整份覆盖草稿。
        </p>
        <p>
          在两个浏览器标签页同时编辑时，另一页提交后本页会自动同步；若两页修改了同一个对象，
          旧预览会立即标记失效并弹出「并列两版」窗口，逐项选择保留本页或采用另一版，
          在你确认合并前当前画布保持不变。互不冲突的改动会自动并入。
        </p>
        <p>
          保存采用「稳定备份 → 暂存校验 → 覆盖主稿」的崩溃安全流程，写入中断或导入坏文件后，
          会从最后稳定版本恢复并重试一次。v1 旧稿在打开时自动升级身份与修订号。
          撤销 / 重做与 JSON 导出都沿用同一条修订关系，导出文件名附带当前修订号（rN）。
        </p>
      </section>
    </main>
  </div>
</template>
