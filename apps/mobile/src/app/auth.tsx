import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";

// Ferme la fenêtre de connexion sur le web, puis revient à l’accueil si le lien kofi://auth est ouvert directement.
WebBrowser.maybeCompleteAuthSession();

export default function AuthReturn() {
  return <Redirect href="/" />;
}
