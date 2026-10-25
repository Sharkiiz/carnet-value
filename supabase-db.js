/* Carnet value — couche de données Supabase.
   Elle imite l'interface utilisée par l'application (collection/doc/onSnapshot/set/delete),
   gère la connexion par e-mail + mot de passe et garde une copie locale pour le hors-ligne. */
(function () {
  "use strict";
  var cfg = window.CARNET_CONFIG || {};
  var CACHE_KEY = "carnet-value-cache-v1";
  var ready = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  var sb = ready ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

  var cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; } catch (e) { cache = {}; }
  var colSubs = {}, docSubs = {};

  function persist() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {} }
  function emitCol(c) {
    var docs = Object.keys(cache[c] || {}).map(function (id) { var d = cache[c][id]; return { id: id, data: function () { return d; } }; });
    (colSubs[c] || []).forEach(function (cb) { cb({ docs: docs }); });
  }
  function emitDoc(c, id) {
    var d = (cache[c] || {})[id];
    (docSubs[c + "/" + id] || []).forEach(function (cb) { cb({ exists: d !== undefined, data: function () { return d; } }); });
  }
  function emitAll() {
    Object.keys(colSubs).forEach(emitCol);
    Object.keys(docSubs).forEach(function (k) { var i = k.indexOf("/"); emitDoc(k.slice(0, i), k.slice(i + 1)); });
  }

  async function fetchAll() {
    var res = await sb.from("docs").select("collection,id,data").limit(5000);
    if (res.error) throw res.error;
    var next = {};
    res.data.forEach(function (r) { (next[r.collection] = next[r.collection] || {})[r.id] = r.data; });
    cache = next; persist(); emitAll();
  }

  var db = {
    collection: function (c) {
      return { onSnapshot: function (cb) { (colSubs[c] = colSubs[c] || []).push(cb); emitCol(c); return function () {}; } };
    },
    doc: function (path) {
      var i = path.indexOf("/"), c = path.slice(0, i), id = path.slice(i + 1);
      return {
        onSnapshot: function (cb) { (docSubs[path] = docSubs[path] || []).push(cb); emitDoc(c, id); return function () {}; },
        set: async function (d) {
          (cache[c] = cache[c] || {})[id] = d; persist(); emitCol(c); emitDoc(c, id);
          var r = await sb.from("docs").upsert({ collection: c, id: id, data: d });
          if (r.error) throw r.error;
        },
        delete: async function () {
          if (cache[c]) delete cache[c][id]; persist(); emitCol(c); emitDoc(c, id);
          var r = await sb.from("docs").delete().eq("collection", c).eq("id", id);
          if (r.error) throw r.error;
        }
      };
    }
  };

  function loginScreen() {
    return new Promise(function (resolve) {
      var box = document.createElement("div");
      box.id = "login";
      box.setAttribute("style", "position:fixed;inset:0;z-index:50;background:var(--paper);display:flex;align-items:center;justify-content:center;padding:20px");
      box.innerHTML =
        '<form class="sheet" style="width:100%;max-width:380px" novalidate>' +
        '<h1 style="margin:0 0 4px">Carnet value</h1>' +
        '<p class="small muted" style="margin:0 0 14px">Connecte-toi avec le compte créé dans Supabase.</p>' +
        '<label for="lg_email">E-mail</label><input id="lg_email" type="email" autocomplete="username" required style="margin-bottom:10px">' +
        '<label for="lg_pw">Mot de passe</label><input id="lg_pw" type="password" autocomplete="current-password" required>' +
        '<p id="lg_err" class="small neg" role="alert" style="min-height:1.2em;margin:8px 0"></p>' +
        '<button class="btn" type="submit" style="width:100%">Se connecter</button></form>';
      document.body.appendChild(box);
      var form = box.querySelector("form"), err = box.querySelector("#lg_err");
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        err.textContent = "";
        var btn = form.querySelector("button"); btn.disabled = true; btn.textContent = "Connexion…";
        var r = await sb.auth.signInWithPassword({ email: box.querySelector("#lg_email").value.trim(), password: box.querySelector("#lg_pw").value });
        btn.disabled = false; btn.textContent = "Se connecter";
        if (r.error) { err.textContent = navigator.onLine ? "E-mail ou mot de passe incorrect." : "Pas de connexion internet."; return; }
        box.remove(); resolve();
      });
    });
  }

  async function ensureSession() {
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) return;
    await loginScreen();
  }

  window.carnetLogout = async function () { if (sb) await sb.auth.signOut(); localStorage.removeItem(CACHE_KEY); location.reload(); };

  window.claude = {
    use: async function (name) {
      if (name !== "db") return null;
      if (!ready) {
        alert("Configuration manquante : renseigne l’adresse et la clé Supabase dans config.js.");
        return null;
      }
      await ensureSession();
      fetchAll().catch(function () { /* hors ligne : on garde la copie locale */ });
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") fetchAll().catch(function () {}); });
      window.addEventListener("online", function () { fetchAll().catch(function () {}); });
      return db;
    }
  };
})();
