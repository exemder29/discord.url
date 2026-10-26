import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { db } from "./firebase.js";
import {
  REDIRECT_URI, isConfigured, startDiscordLogin, consumeCallback, storedSession,
  fetchDiscordData, ensureFirebaseSession, explainFirebaseError, logout, avatarUrl, guildIconUrl,
} from "./auth.js";

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle("hidden", !on);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const RESERVED = ["admin","api","login","logout","auth","app","dashboard","index","about","terms","privacy","help","support","discord","static"];
const HOST = location.host;

function toast(text, kind = "ok") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`; t.textContent = text;
  $("toasts").append(t);
  setTimeout(() => { t.style.transition = "opacity .3s"; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, 3800);
}
function confetti() {
  const colors = ["#7c5cff", "#38d0ff", "#ff5ca8", "#34d399", "#fbbf24"];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.background = colors[i % colors.length];
    c.style.left = "50%"; c.style.top = "45%";
    document.body.append(c);
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 280;
    c.animate([
      { transform: "translate(-50%,-50%) rotate(0)", opacity: 1 },
      { transform: `translate(${Math.cos(a) * d - 4}px, ${Math.sin(a) * d + 220}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 700, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => c.remove();
  }
}
const initials = (n) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
function iconNode(cls, id, icon, name) {
  const url = guildIconUrl(id, icon);
  if (url) { const im = document.createElement("img"); im.className = cls; im.src = url; im.alt = ""; return im; }
  const d = document.createElement("div"); d.className = cls; d.textContent = initials(name); return d;
}

// =====================================================================
//  Mode redirection : https://site/mon-lien
// =====================================================================
const path = decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g, "").toLowerCase();
if (path && path !== "index.html") runRedirect(path);
else { show($("app")); runApp(); }

async function runRedirect(slug) {
  show($("redirect"));
  try {
    const snap = await getDoc(doc(db, "links", slug));
    if (!snap.exists()) {
      $("redirEyebrow").textContent = "Erreur 404";
      $("redirTitle").textContent = "Lien introuvable";
      $("redirSub").textContent = "Ce lien n'existe pas ou a été supprimé.";
      $("redirIcon").textContent = "🤷"; show($("redirLoader"), false); show($("redirHome"));
      return;
    }
    const d = snap.data();
    $("redirIcon").textContent = ""; $("redirIcon").append(iconNode("", d.guildId, d.guildIcon, d.guildName));
    $("redirEyebrow").textContent = "Tu es invité à rejoindre";
    $("redirTitle").textContent = d.guildName;
    $("redirSub").textContent = "Redirection vers Discord…";
    setTimeout(() => location.replace(d.invite), 900);
  } catch (e) {
    $("redirEyebrow").textContent = "Erreur";
    $("redirTitle").textContent = "Impossible de charger le lien";
    $("redirSub").textContent = explainFirebaseError(e);
    show($("redirLoader"), false); show($("redirHome"));
  }
}

// =====================================================================
//  Application
// =====================================================================
let session = null, selected = null, uid = null;

function runApp() {
  $("heroHost").textContent = HOST + "/";
  $("prefix").textContent = HOST + "/";
  $("pvHost").textContent = HOST + "/";
  $("redirUri").textContent = REDIRECT_URI;
  $("copyRedir").onclick = async () => { await navigator.clipboard.writeText(REDIRECT_URI); toast("Adresse copiée ✓"); };
  typing();

  const login = () => {
    try { startDiscordLogin(); }
    catch (e) { showLoginError(e.message); $("setup").open = true; }
  };
  $("btnLoginHero").onclick = login;
  $("btnLoginNav").onclick = login;
  $("btnLogout").onclick = () => { logout(); location.href = "/"; };
  $("btnCreate").onclick = createLink;
  $("slug").addEventListener("input", onSlugInput);
  $("invite").addEventListener("input", onInviteInput);

  const cb = consumeCallback();
  if (cb?.error) { showLoginError(cb.error); return; }
  const s = cb || storedSession();
  if (s) loadSession(s.token);
  else if (!isConfigured()) { showLoginError("Client ID Discord manquant dans config.js."); $("setup").open = true; }
}

function showLoginError(text) { const e = $("loginErr"); e.textContent = text; show(e); }

async function loadSession(token) {
  show($("btnLoginHero"), false);
  try {
    const data = await fetchDiscordData(token);
    uid = await ensureFirebaseSession();
    session = { token, ...data };
    renderUser(); renderGuilds();
    show($("hero"), false); show($("dash")); show($("btnLoginNav"), false); show($("navUser"));
    loadMyLinks();
  } catch (e) {
    sessionStorage.removeItem("dc_session");
    show($("btnLoginHero"));
    showLoginError(e.message || "Connexion impossible.");
    $("setup").open = true;
  }
}

function renderUser() {
  const u = session.user, name = u.global_name || u.username;
  $("uName").textContent = name; $("hello").textContent = name;
  $("uAvatar").src = avatarUrl(u);
}

function renderGuilds() {
  const box = $("guilds"); box.textContent = "";
  show($("noGuild"), session.guilds.length === 0);
  for (const g of session.guilds) {
    const b = document.createElement("button");
    b.className = "guild"; b.type = "button";
    const nm = document.createElement("span"); nm.className = "g-name"; nm.textContent = g.name;
    const tag = document.createElement("span"); tag.className = "g-tag"; tag.textContent = g.owner ? "Propriétaire" : "Gestionnaire";
    b.append(iconNode("g-ico", g.id, g.icon, g.name), nm, tag);
    b.onclick = () => selectGuild(g, b);
    box.append(b);
  }
}

function selectGuild(g, btn) {
  selected = g;
  document.querySelectorAll(".guild").forEach((x) => x.classList.remove("sel"));
  btn.classList.add("sel");
  $("formCard").classList.remove("locked");
  $("pvName").textContent = g.name;
  $("pvSub").textContent = g.owner ? "Tu es le propriétaire" : "Tu gères ce serveur";
  const pv = $("pvIcon"); pv.textContent = "";
  const url = guildIconUrl(g.id, g.icon);
  if (url) { const im = document.createElement("img"); im.src = url; im.alt = ""; pv.append(im); } else pv.textContent = initials(g.name);
  if (!$("slug").value) {
    $("slug").value = g.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    onSlugInput();
  }
  refreshCreate();
}

// ---------- Champs : nom du lien
let slugTimer, slugOk = false;
function setStatus(fieldEl, statusEl, kind, text) {
  fieldEl.classList.toggle("good", kind === "ok"); fieldEl.classList.toggle("bad", kind === "no");
  statusEl.className = `status ${kind}`; statusEl.textContent = text;
}
function onSlugInput() {
  const inp = $("slug");
  inp.value = inp.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const v = inp.value, field = inp.parentElement;
  $("pvSlug").textContent = v || "ton-nom";
  slugOk = false; clearTimeout(slugTimer); refreshCreate();
  if (!v) return setStatus(field, $("slugStatus"), "", "");
  if (!SLUG_RE.test(v)) return setStatus(field, $("slugStatus"), "no", v.length < 3 ? "Trop court" : "Invalide");
  if (RESERVED.includes(v)) return setStatus(field, $("slugStatus"), "no", "Réservé");
  setStatus(field, $("slugStatus"), "wait", "Vérification…");
  slugTimer = setTimeout(async () => {
    try {
      const snap = await getDoc(doc(db, "links", v));
      if (inp.value !== v) return;
      slugOk = !snap.exists();
      setStatus(field, $("slugStatus"), slugOk ? "ok" : "no", slugOk ? "Disponible ✓" : "Déjà pris");
    } catch (e) { setStatus(field, $("slugStatus"), "no", "Erreur"); toast(explainFirebaseError(e), "err"); }
    refreshCreate();
  }, 350);
}

// ---------- Champs : invitation
function parseInvite(v) {
  v = v.trim();
  const m = v.match(/^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})\/?(?:\?.*)?$/) || v.match(/^([A-Za-z0-9-]{2,32})$/);
  return m ? m[1] : null;
}
function onInviteInput() {
  const v = $("invite").value, field = $("invite").parentElement;
  if (!v.trim()) setStatus(field, $("inviteStatus"), "", "");
  else if (parseInvite(v)) setStatus(field, $("inviteStatus"), "ok", "Format ✓");
  else setStatus(field, $("inviteStatus"), "no", "Format invalide");
  refreshCreate();
}
function refreshCreate() { $("btnCreate").disabled = !(selected && slugOk && parseInvite($("invite").value)); }

function msg(text, kind) { const el = $("formMsg"); el.className = `alert ${kind}`; el.textContent = text; }

// ---------- Création
async function createLink() {
  const slug = $("slug").value, code = parseInvite($("invite").value);
  if (!selected || !slugOk || !code) return;
  $("btnCreate").disabled = true; msg("Vérification de l'invitation…", "warn");
  try {
    let note = "";
    try {
      const r = await fetch(`https://discord.com/api/v10/invites/${code}`);
      if (r.status === 404) throw new Error("Cette invitation n'existe pas ou a expiré.");
      if (r.ok) {
        const inv = await r.json();
        if (inv.guild && inv.guild.id !== selected.id) throw new Error(`Cette invitation mène vers « ${inv.guild.name} », pas vers « ${selected.name} ».`);
        if (inv.expires_at) throw new Error("Cette invitation expire un jour. Crée-en une avec l'expiration « Jamais ».");
      }
    } catch (e) { if (e instanceof TypeError) note = " (invitation non vérifiée)"; else throw e; }

    uid = await ensureFirebaseSession();
    await setDoc(doc(db, "links", slug), {
      slug, invite: `https://discord.gg/${code}`,
      guildId: selected.id, guildName: selected.name.slice(0, 100), guildIcon: selected.icon || null,
      ownerUid: uid, ownerDiscordId: session.user.id,
      ownerName: (session.user.global_name || session.user.username).slice(0, 100),
      createdAt: serverTimestamp(),
    });
    msg(`✅ Ton lien est prêt : ${HOST}/${slug}${note}`, "ok");
    confetti();
    try { await navigator.clipboard.writeText(`${location.origin}/${slug}`); toast("Lien copié dans le presse-papiers ✓"); } catch {}
    $("slug").value = ""; $("invite").value = ""; slugOk = false;
    setStatus($("slug").parentElement, $("slugStatus"), "", ""); setStatus($("invite").parentElement, $("inviteStatus"), "", "");
    $("pvSlug").textContent = slug;
    loadMyLinks();
  } catch (e) {
    msg(e.code ? explainFirebaseError(e) : e.message, "err");
  } finally { refreshCreate(); }
}

// ---------- Mes liens
async function loadMyLinks() {
  const box = $("myLinks");
  try {
    const snap = await getDocs(query(collection(db, "links"), where("ownerUid", "==", uid)));
    const list = snap.docs.map((d) => d.data()).sort((a, b) => (b.createdAt?.seconds ?? 9e9) - (a.createdAt?.seconds ?? 9e9));
    $("linkCount").textContent = list.length;
    box.textContent = "";
    if (!list.length) { const e = document.createElement("div"); e.className = "empty"; e.textContent = "Tu n'as pas encore de lien. Crée le premier juste au-dessus ✨"; box.append(e); return; }
    for (const l of list) {
      const card = document.createElement("div"); card.className = "lk";
      const top = document.createElement("div"); top.className = "lk-top";
      const t = document.createElement("div"); t.className = "lk-t";
      const a = document.createElement("a"); a.href = `/${l.slug}`; a.target = "_blank"; a.rel = "noopener"; a.textContent = `${HOST}/${l.slug}`;
      const s = document.createElement("small"); s.textContent = l.guildName;
      t.append(a, s); top.append(iconNode("g-ico", l.guildId, l.guildIcon, l.guildName), t);
      const act = document.createElement("div"); act.className = "lk-act";
      const cp = document.createElement("button"); cp.className = "btn ghost"; cp.textContent = "Copier";
      cp.onclick = async () => { await navigator.clipboard.writeText(`${location.origin}/${l.slug}`); cp.textContent = "Copié ✓"; setTimeout(() => (cp.textContent = "Copier"), 1500); };
      const del = document.createElement("button"); del.className = "btn danger"; del.textContent = "Supprimer";
      del.onclick = async () => {
        if (!confirm(`Supprimer définitivement ${HOST}/${l.slug} ?`)) return;
        try { await deleteDoc(doc(db, "links", l.slug)); toast("Lien supprimé"); loadMyLinks(); onSlugInput(); }
        catch (e) { toast(explainFirebaseError(e), "err"); }
      };
      act.append(cp, del); card.append(top, act); box.append(card);
    }
  } catch (e) {
    box.textContent = ""; const er = document.createElement("div"); er.className = "alert err"; er.textContent = explainFirebaseError(e); box.append(er);
  }
}

// ---------- Animation de frappe de l'accueil
function typing() {
  const words = ["ma-guilde", "les-gamers", "team-valorant", "club-manga", "ton-serveur"];
  const el = $("typed"); let w = 0, i = 0, del = false;
  (function tick() {
    const word = words[w];
    el.textContent = word.slice(0, i);
    if (!del && i === word.length) { del = true; return setTimeout(tick, 1400); }
    if (del && i === 0) { del = false; w = (w + 1) % words.length; }
    i += del ? -1 : 1;
    setTimeout(tick, del ? 45 : 95);
  })();
}
