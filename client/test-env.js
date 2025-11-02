// Test script pour vérifier les variables d'environnement
console.log('=== TEST VARIABLES D\'ENVIRONNEMENT ===');
console.log('VITE_GOOGLE_CLIENT_ID:', import.meta.env.VITE_GOOGLE_CLIENT_ID);
console.log('VITE_API_URL:', import.meta.env.VITE_API_URL);
console.log('VITE_ENABLE_GOOGLE_AUTH:', import.meta.env.VITE_ENABLE_GOOGLE_AUTH);

// Simuler la fonction isGoogleAuthEnabled
const isEnabled = !!(import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_API_URL);
console.log('isGoogleAuthEnabled():', isEnabled);

if (!isEnabled) {
  console.error('❌ Google Auth non activé - variables manquantes');
} else {
  console.log('✅ Google Auth activé');
}