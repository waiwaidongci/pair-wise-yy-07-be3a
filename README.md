# FrameFlow 流程图与 ERD 编辑器

基于 Vue 3、TypeScript、Vite、Element Plus、Pinia、Vue Router 和 Konva 构建。

## 功能

- 矩形、圆形、菱形、数据库表节点和连接线
- 从锚点拖拽连线、自动吸附、移动节点时连接线跟随
- 正交折线路由与节点绕行
- 拖动对齐参考线和实时距离提示
- 多选、分组、锁定、复制、层级调整
- 撤销 / 重做、缩略图、缩放、平移和适应画布
- 本地 JSON 保存 / 导入、SVG 导出
- localStorage 自动恢复最近编辑内容

## 运行

```bash
export PATH="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH"
corepack pnpm install
corepack pnpm dev
corepack pnpm build
```
