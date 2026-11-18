/**
 * Adresse du serveur KOFI (le même que le site web). À définir au build :
 *   EXPO_PUBLIC_API_URL=https://kofi.example.cm npx expo start
 * En développement sur un téléphone, utilisez l’adresse IP de l’ordinateur (pas « localhost »).
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
