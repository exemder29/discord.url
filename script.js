import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-analytics.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDH1JRDT2EClO7_awG0h3-p6II70ITTbBU",
  authDomain: "url-discord-generator.firebaseapp.com",
  projectId: "url-discord-generator",
  storageBucket: "url-discord-generator.firebasestorage.app",
  messagingSenderId: "1085927207592",
  appId: "1:1085927207592:web:c1174f13c2e6ae364e489d",
  measurementId: "G-884LRPCCRD"
};

// ⚠️ À REMPLIR : "Client ID" de ton application sur https://discord.com/developers/applications → OAuth2
const DISCORD_CLIENT_ID = "COLLE_TON_CLIENT_ID_ICI";

const app = initializeApp(firebaseConfig);
try { getAnalytics(app); } catch {}
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle('hidden', !on);
const REDIRECT_URI = location.origin + '/';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const RESERVED = ['admin','api','login','logout','auth','app','dashboard','index','about','terms','privacy','help','support','discord','static'];
const MANAGE_GUILD = 0x20n, ADMIN = 0x8n;

// ---------- Mode redirection : /mon-lien
const path = decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
if (path && path !== 'index.html') {
  show($('redirect'));
  (async () => {
    try {
      const snap = await getDoc(doc(db, 'links', path));
      if (snap.exists()) {
        $('redirSub').textContent = snap.data().guildName || '';
        location.replace(snap.data().invite);
      } else {
        $('redirTitle').textContent = 'Lien introuvable';
        $('redirSub').textContent = "Ce lien n'existe pas (ou plus).";
        show($('redirHome'));
      }
    } catch {
      $('redirTitle').textContent = 'Erreur';
      $('redirSub').textContent = 'Impossible de charger ce lien pour le moment.';
      show($('redirHome'));
    }
  })();
} else {
  show($('app'));
  start();
}

// ---------- Application
let session = null;      // { token, user, guilds }
let selected = null;     // serveur choisi
let uid = null;

$('prefix').textContent = location.host + '/';

function start() {
  $('btnLogin').onclick = login;
  $('btnLogout').onclick = logout;
  $('btnCreate').onclick = createLink;

  onAuthStateChanged(auth, (u) => { uid = u ? u.uid : null; });

  // Retour de Discord : le token est dans le fragment de l'URL
  if (location.hash.includes('access_token')) {
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', REDIRECT_URI);
    const state = p.get('state');
    if (!state || state !== sessionStorage.getItem('oauth_state')) {
      show($('login')); return fail('loginErr', 'Connexion refusée (état invalide). Réessaie.');
    }
    sessionStorage.removeItem('oauth_state');
    const token = p.get('access_token');
    const ttl = Number(p.get('expires_in') || 600);
    sessionStorage.setItem('dc', JSON.stringify({ token, exp: Date.now() + ttl * 1000 }));
  }
  const saved = JSON.parse(sessionStorage.getItem('dc') || 'null');
  if (saved && saved.exp > Date.now()) loadSession(saved.token);
  else show($('login'));
}

function fail(id, text) { const el = $(id); el.textContent = text; show(el); }

function login() {
  if (DISCORD_CLIENT_ID.startsWith('COLLE')) return fail('loginErr', "Renseigne DISCORD_CLIENT_ID dans index.html.");
  const state = crypto.randomUUID();
  sessionStorage.setItem('oauth_state', state);
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID, response_type: 'token', scope: 'identify guilds',
    redirect_uri: REDIRECT_URI, state, prompt: 'none'
  });
  location.href = url;
}

function logout() { sessionStorage.removeItem('dc'); location.reload(); }

async function loadSession(token) {
  try {
    const h = { Authorization: `Bearer ${token}` };
    const [meR, gR] = await Promise.all([
      fetch('https://discord.com/api/v10/users/@me', { headers: h }),
      fetch('https://discord.com/api/v10/users/@me/guilds', { headers: h })
    ]);
    if (!meR.ok || !gR.ok) throw new Error('Session Discord expirée');
    const user = await meR.json();
    const guilds = (await gR.json()).filter((g) => g.owner || (BigInt(g.permissions) & (MANAGE_GUILD | ADMIN)));
    session = { token, user, guilds };
    if (!auth.currentUser) await signInAnonymously(auth);
    uid = auth.currentUser.uid;
    renderUser(); renderGuilds(); loadMyLinks();
    show($('login'), false); show($('logged'));
  } catch (e) {
    sessionStorage.removeItem('dc');
    show($('login')); fail('loginErr', e.message || 'Connexion impossible.');
  }
}

function renderUser() {
  const u = session.user;
  $('uName').textContent = u.global_name || u.username;
  $('uAvatar').src = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function renderGuilds() {
  const box = $('guilds'); box.textContent = '';
  show($('noGuild'), session.guilds.length === 0);
  for (const g of session.guilds) {
    const b = document.createElement('button');
    b.className = 'guild'; b.type = 'button';
    if (g.icon) { const im = document.createElement('img'); im.src = `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`; im.alt = ''; b.append(im); }
    else { const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = g.name.slice(0, 1).toUpperCase(); b.append(ph); }
    const sp = document.createElement('span'); sp.textContent = g.name; b.append(sp);
    b.onclick = () => {
      selected = g;
      box.querySelectorAll('.guild').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      show($('formCard'));
      if (!$('slug').value) $('slug').value = g.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
    };
    box.append(b);
  }
}

function parseInvite(v) {
  v = v.trim();
  const m = v.match(/^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})\/?$/) || v.match(/^([A-Za-z0-9-]{2,32})$/);
  return m ? m[1] : null;
}

function msg(text, kind) { const el = $('formMsg'); el.className = `msg ${kind}`; el.textContent = text; }

async function createLink() {
  if (!selected) return msg('Choisis d\'abord un serveur.', 'err');
  const slug = $('slug').value.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return msg('Nom invalide : 3 à 32 caractères, lettres minuscules, chiffres et tirets (pas au début ni à la fin).', 'err');
  if (RESERVED.includes(slug)) return msg('Ce nom est réservé, choisis-en un autre.', 'err');
  const code = parseInvite($('invite').value);
  if (!code) return msg("Invitation invalide. Exemple : https://discord.gg/abcdEF", 'err');

  $('btnCreate').disabled = true; msg('Vérification…', 'warn');
  try {
    // L'invitation doit appartenir au serveur choisi et ne pas expirer
    let warn = '';
    try {
      const r = await fetch(`https://discord.com/api/v10/invites/${code}`);
      if (r.status === 404) throw new Error("Cette invitation n'existe pas ou a expiré.");
      if (r.ok) {
        const inv = await r.json();
        if (inv.guild && inv.guild.id !== selected.id) throw new Error(`Cette invitation mène vers « ${inv.guild.name} », pas vers « ${selected.name} ».`);
        if (inv.expires_at) throw new Error("Cette invitation expire. Crée-en une avec l'expiration « Jamais ».");
      }
    } catch (e) { if (e instanceof TypeError) warn = "Invitation non vérifiée (Discord injoignable). "; else throw e; }

    if (!auth.currentUser) await signInAnonymously(auth);
    uid = auth.currentUser.uid;
    const existing = await getDoc(doc(db, 'links', slug));
    if (existing.exists()) throw new Error('Ce nom est déjà pris, essaie-en un autre.');

    await setDoc(doc(db, 'links', slug), {
      slug, invite: `https://discord.gg/${code}`,
      guildId: selected.id, guildName: selected.name.slice(0, 100), guildIcon: selected.icon || null,
      ownerUid: uid, ownerDiscordId: session.user.id, ownerName: (session.user.global_name || session.user.username).slice(0, 100),
      createdAt: serverTimestamp()
    });
    msg(`${warn}✅ Lien créé : ${location.host}/${slug}`, 'ok');
    $('slug').value = ''; $('invite').value = '';
    loadMyLinks();
  } catch (e) {
    msg(e.code === 'permission-denied' ? 'Refusé par la base de données (règles Firestore ou nom déjà pris).' : e.message, 'err');
  } finally { $('btnCreate').disabled = false; }
}

async function loadMyLinks() {
  const box = $('myLinks');
  try {
    const snap = await getDocs(query(collection(db, 'links'), where('ownerUid', '==', uid)));
    box.textContent = '';
    if (snap.empty) { box.innerHTML = '<p class="small">Aucun lien pour le moment.</p>'; return; }
    const docs = snap.docs.map((d) => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    for (const l of docs) {
      const row = document.createElement('div'); row.className = 'link';
      const left = document.createElement('div');
      const a = document.createElement('a'); a.href = `/${l.slug}`; a.target = '_blank'; a.textContent = `${location.host}/${l.slug}`;
      const sm = document.createElement('div'); sm.className = 'small'; sm.textContent = l.guildName;
      left.append(a, sm);
      const right = document.createElement('div'); right.className = 'row';
      const cp = document.createElement('button'); cp.className = 'ghost'; cp.textContent = 'Copier';
      cp.onclick = async () => { await navigator.clipboard.writeText(`${location.origin}/${l.slug}`); cp.textContent = 'Copié ✓'; setTimeout(() => (cp.textContent = 'Copier'), 1500); };
      const del = document.createElement('button'); del.className = 'danger'; del.textContent = 'Supprimer';
      del.onclick = async () => { if (confirm(`Supprimer ${l.slug} ?`)) { await deleteDoc(doc(db, 'links', l.slug)); loadMyLinks(); } };
      right.append(cp, del); row.append(left, right); box.append(row);
    }
  } catch { box.innerHTML = '<p class="small">Impossible de charger tes liens.</p>'; }
}
