<template>
  <v-app>
    <v-app-bar flat color="surface" border="b" height="68">
      <v-container class="d-flex align-center py-0">
        <router-link to="/" class="brand-home" aria-label="Juan Nutrisyon home">
          <div class="brand-mark" aria-hidden="true">
            <v-icon icon="mdi-line-scan" size="24" />
          </div>
          <div class="ml-3">
            <div class="text-subtitle-1 font-weight-bold brand-title">Juan Nutrisyon</div>
            <div class="text-caption text-medium-emphasis brand-subtitle">Nutrition Label Scanner</div>
          </div>
        </router-link>
        <v-spacer />
        <v-chip v-if="$route.name === 'improve'" size="small" color="primary" variant="tonal">Review required</v-chip>
        <v-btn v-else to="/improve" variant="text" size="small" class="improve-link">Help improve scanning</v-btn>
      </v-container>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>

    <v-footer class="justify-center text-caption text-medium-emphasis py-5">
      Images stay in your browser during this scan.
    </v-footer>
  </v-app>
</template>
