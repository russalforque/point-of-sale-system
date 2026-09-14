import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sellix.pos',
  appName: 'Sellix POS',
  webDir: 'dist',

  server: {
    androidScheme: 'http'
  }
};

export default config;