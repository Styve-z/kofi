import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Jeton de session de l’app. Sur téléphone : stockage chiffré du système (Keychain / Keystore).
 * En mode web (développement), SecureStore n’existe pas : repli sur le stockage du navigateur.
 */
const KEY = "kofi.session";
let memory: string | null = null;

export async function loadToken() {
  try {
    memory = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY);
  } catch {
    memory = null;
  }
  return memory;
}

export async function saveToken(token: string | null) {
  memory = token;
  try {
    if (Platform.OS === "web") {
      if (token) globalThis.localStorage?.setItem(KEY, token);
      else globalThis.localStorage?.removeItem(KEY);
    } else if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Stockage indisponible : la session reste en mémoire pour cette ouverture de l’app.
  }
}

/** Lu de façon synchrone à chaque appel API. */
export const currentToken = () => memory;
