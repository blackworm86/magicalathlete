import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

// Fill via .env.local (VITE_FIREBASE_*). Web config values are public identifiers, not secrets;
// security comes from database.rules.json.
const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});
export const auth = getAuth(app);
export const db = getDatabase(app);
export const signIn = () => signInAnonymously(auth);
