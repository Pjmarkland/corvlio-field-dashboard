import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Bundle ID must match the App ID registered in Apple Developer / Google Play.
  // iOS: com.corvlio.fielddashboard
  // Android: com.corvlio.fielddashboard
  appId: 'com.corvlio.fielddashboard',
  appName: 'Corvlio',
  // Native builds read the deployed production URL at build time.
  // Override with CAPACITOR_SERVER_URL in CI to point at the correct deployment.
  webDir: 'dist/public',
  server: {
    // During development in a simulator/emulator, point at the Replit dev domain.
    // Comment this out before producing a production build.
    // url: process.env.CAPACITOR_DEV_URL,
    cleartext: false,
    iosScheme: 'capacitor',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    App: {
      // Deep-link scheme used when tapping a notification:  corvlio://leads/:id
      // Register this as a Custom URL Scheme in Xcode and as an Intent Filter in
      // AndroidManifest.xml before native builds.
    },
  },
};

export default config;
