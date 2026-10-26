// ============================================================
//  AUTHENTIFICATION : connexion Discord (OAuth2) + session Firebase
// ============================================================
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { auth } from "./firebase.js";
import { DISCORD_CLIENT_ID } from "./config.js";

const API = "https://discord.com/api/v10";
const STORE = "dc_session";
const STATE_KEY = "dc_oauth_state";
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;

// L'adresse EXACTE à ajouter dans Discord → OAuth2 → Redirects
export const REDIRECT_URI = location.origin + "/";

export const isConfigured = () => !!DISCORD_CLIENT_ID && !DISCORD_CLIENT_ID.startsWith("COLLE");

// ---------- 1. Envoi vers Discord
export function startDiscordLogin() {
  if (!isConfigured()) throw new Error("Le Client ID Discord n'est pas renseigné dans config.js.");
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: "token",
    scope: "identify guilds",
    redirect_uri: REDIRECT_URI,
    state,
  });
  location.href = `https://discord.com/oauth2/authorize?${params}`;
}

// ---------- 2. Retour de Discord (à appeler au chargement de la page)
// Retourne null (rien à traiter), { token, expiresAt } ou { error }
export function consumeCallback() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const hasToken = hash.has("access_token");
  const err = query.get("error") || hash.get("error");
  if (!hasToken && !err) return null;

  const state = hash.get("state") || query.get("state");
  const token = hash.get("access_token");
  const expires = Number(hash.get("expires_in") || 600);
  history.replaceState(null, "", REDIRECT_URI);

  if (err) {
    return { error: err === "access_denied" ? "Tu as refusé la connexion sur Discord." : `Discord a refusé la connexion (${err}).` };
  }
  if (!state || state !== sessionStorage.getItem(STATE_KEY)) {
    return { error: "Connexion annulée par sécurité (état invalide). Réessaie." };
  }
  sessionStorage.removeItem(STATE_KEY);
  const saved = { token, expiresAt: Date.now() + expires * 1000 };
  sessionStorage.setItem(STORE, JSON.stringify(saved));
  return saved;
}

export function storedSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORE) || "null");
    return s && s.expiresAt > Date.now() ? s : null;
  } catch { return null; }
}

// ---------- 3. Récupération du profil + des serveurs gérables
export async function fetchDiscordData(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const [meRes, guildsRes] = await Promise.all([
    fetch(`${API}/users/@me`, { headers }),
    fetch(`${API}/users/@me/guilds`, { headers }),
  ]);
  if (meRes.status === 401 || guildsRes.status === 401) throw new Error("Ta session Discord a expiré, reconnecte-toi.");
  if (!meRes.ok || !guildsRes.ok) throw new Error(`Discord ne répond pas (code ${meRes.status}/${guildsRes.status}).`);
  const user = await meRes.json();
  const all = await guildsRes.json();
  const guilds = all
    .filter((g) => g.owner || (BigInt(g.permissions) & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n)
    .sort((a, b) => Number(b.owner) - Number(a.owner) || a.name.localeCompare(b.name));
  return { user, guilds };
}

// ---------- 4. Session Firebase (anonyme) : identifie ce navigateur pour les règles Firestore
export async function ensureFirebaseSession() {
  if (auth.currentUser) return auth.currentUser.uid;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user.uid;
  } catch (e) {
    throw new Error(explainFirebaseError(e));
  }
}

export function explainFirebaseError(e) {
  const code = e?.code || "";
  if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation")
    return "La connexion « Anonyme » n'est pas activée : Firebase → Authentication → Méthode de connexion → Anonyme → Activer.";
  if (code === "auth/configuration-not-found")
    return "Firebase Authentication n'est pas initialisé : ouvre Firebase → Authentication et clique sur « Commencer ».";
  if (code === "auth/unauthorized-domain")
    return `Domaine non autorisé : Firebase → Authentication → Paramètres → Domaines autorisés → ajoute ${location.hostname}.`;
  if (code.startsWith("auth/api-key") || code === "auth/invalid-api-key")
    return "La clé API Firebase est invalide : vérifie config.js.";
  if (code === "permission-denied")
    return "Refusé par Firestore : publie le fichier firestore.rules dans Firebase → Firestore → Règles.";
  if (code === "unavailable" || code === "auth/network-request-failed")
    return "Réseau indisponible (ou bloqué par un bloqueur de pub). Réessaie.";
  return e?.message || "Erreur inconnue.";
}

export function logout() {
  sessionStorage.removeItem(STORE);
  sessionStorage.removeItem(STATE_KEY);
  auth.signOut().catch(() => {});
}

export const avatarUrl = (u) =>
  u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
           : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
export const guildIconUrl = (id, icon, size = 128) =>
  icon ? `https://cdn.discordapp.com/icons/${id}/${icon}.${icon.startsWith("a_") ? "gif" : "png"}?size=${size}` : null;
