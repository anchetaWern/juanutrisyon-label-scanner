import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import 'roboto-fontface/css/roboto/roboto-fontface.css'
import App from './App.vue'
import router from './router'
import './styles/main.css'

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'juanLight',
    themes: {
      juanLight: {
        dark: false,
        colors: {
          primary: '#0b6b56',
          secondary: '#e78b36',
          background: '#f5f7f3',
          surface: '#ffffff',
          info: '#246b90',
          warning: '#a96005',
          error: '#b3261e',
          success: '#287d55',
        },
      },
    },
  },
})

createApp(App).use(router).use(vuetify).mount('#app')
