import { CapacitorConfig } from '@capacitor/cli';

// Capacitor 7 does not expose an iOS deployment-target option. Keep this
// release invariant aligned with the Podfile and Xcode project; preflight
// verifies all three before native assets are synced.
export const IOS_MINIMUM_DEPLOYMENT_TARGET = '17.0';

const config: CapacitorConfig = {
  // Bundle ID must match the App ID registered in Apple Developer / Google Play.
  // iOS: com.corvlio.fielddashboard
  // Android: com.corvlio.fielddashboard
  appId: 'com.corvlio.fielddashboard',
  appName: 'Corvlio',
  // Production native builds use the bundled assets in webDir. Keep server.url
  // unset; a remote URL here would make TestFlight depend on a live web page.
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
