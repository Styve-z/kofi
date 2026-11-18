import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { API_URL } from "./config";
import { saveToken } from "./session";
import { trpc } from "./trpc";

/**
 * Connexion de l’app via le site KOFI (échange de type PKCE, voir server/modules/mobileAuth.ts) :
 * l’app garde un secret, le site renvoie un code à usage unique, l’app échange les deux contre un jeton.
 */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes: Uint8Array) {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const [a, b = 0, c = 0] = [bytes[index], bytes[index + 1], bytes[index + 2]];
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64[(triple >> 18) & 63] + BASE64[(triple >> 12) & 63] + (index + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : "=") + (index + 2 < bytes.length ? BASE64[triple & 63] : "=");
  }
  return out;
}
const toBase64Url = (value: string) => value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

type AuthState = {
  user: { id: number; name: string | null; role: string } | null;
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const exchange = trpc.mobile.exchange.useMutation();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async () => {
    setError(null);
    setSigningIn(true);
    try {
      const verifier = toBase64Url(base64(Crypto.getRandomBytes(32)));
      const challenge = toBase64Url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
      const redirect = Linking.createURL("auth");
      const url = `${API_URL}/connexion-app?challenge=${challenge}&redirect=${encodeURIComponent(redirect)}`;
      const result = await WebBrowser.openAuthSessionAsync(url, redirect);
      if (result.type !== "success") return;
      const code = Linking.parse(result.url).queryParams?.code;
      if (typeof code !== "string") throw new Error("MOBILE_LOGIN_INVALID");
      const session = await exchange.mutateAsync({ code, verifier });
      await saveToken(session.token);
      await utils.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "MOBILE_LOGIN_INVALID");
    } finally {
      setSigningIn(false);
    }
  }, [exchange, utils]);

  const logout = useCallback(async () => {
    await saveToken(null);
    utils.auth.me.setData(undefined, null);
    await utils.invalidate();
  }, [utils]);

  const value = useMemo<AuthState>(() => ({
    user: me.data ? { id: me.data.id, name: me.data.name, role: me.data.role } : null,
    loading: me.isLoading, signingIn, error, login, logout,
  }), [me.data, me.isLoading, signingIn, error, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth doit être utilisé dans AuthProvider");
  return value;
}
