import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'scanner',
      component: () => import('@/views/LabelAssessmentView.vue'),
    },
    {
      path: '/improve',
      name: 'improve',
      component: () => import('@/views/ScannerView.vue'),
    },
  ],
})
