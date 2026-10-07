import { createRouter, createWebHistory } from 'vue-router';
import EditorView from '../views/EditorView.vue';
import GuideView from '../views/GuideView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'editor', component: EditorView },
    { path: '/guide', name: 'guide', component: GuideView },
  ],
});
