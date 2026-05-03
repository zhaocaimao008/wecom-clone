// Detect if running inside a Capacitor native container (Android/iOS).
// When native, API calls and socket connections must use absolute URLs
// because the page is served from capacitor://localhost, not the server origin.
export const isNative =
  typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

export const SERVER = isNative ? 'http://104.244.95.70:3001' : '';
