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
        <h2>保存与导出</h2>
        <p>
          编辑内容会自动保存到 localStorage。JSON 文件包含完整节点、字段、连接线和样式参数，
          可再次导入继续编辑；SVG 导出适合插入文档或交付评审。
        </p>
      </section>
    </main>
  </div>
</template>
