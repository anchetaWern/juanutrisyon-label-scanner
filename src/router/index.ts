import { createRouter, createWebHistory } from 'vue-router'
import ScannerView from '@/views/ScannerView.vue'

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'scanner',
      component: ScannerView,
    },
  ],
})
