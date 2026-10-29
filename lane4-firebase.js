// lane4-firebase.js — accounts (email + password, verified email), cloud save, and Rankings for Lane 4 on the web.
// It plugs Firebase into the small interface the app already uses (window.claude.use("db") / ("user")).
import { firebaseConfig } from "./firebase-config.js";
const $ = id => document.getElementById(id);
const configured = !String(firebaseConfig.apiKey).includes("PASTE");
const gate = $("authGate");

// Translate Firebase error codes into the ones the app already handles.
const mapErr = e => {
  const c = (e && e.code) || "";
  const code = c === "permission-denied" ? "invalid_argument" : c === "resource-exhausted" ? "quota_exceeded" : c === "unavailable" ? "unavailable" : c;
  return Object.assign(new Error(e && e.message), { code });
};
const wrap = p => p.catch(e => { throw mapErr(e); });

if (!configured) {
  // No Firebase yet: the app still works fully on this device.
  window.__lane4.resolveReady(null);
  $("acctBox").hidden = true;
} else {
  let fb;
  try {
    const [a, au, f] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")]);
    fb = { ...a, ...au, ...f };
  } catch (e) { fb = null; }
  if (!fb) { window.__lane4.resolveReady(null); $("acctLine").textContent = "Can’t reach the account service right now. Your data saves on this device."; }
  else start(fb);
}
function start({ initializeApp, getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, deleteUser, reload,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, reauthenticateWithPopup,
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs }) {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const fs = getFirestore(app);

  const D = p => {
    const ref = doc(fs, p);
    return {
      get: () => wrap(getDoc(ref)).then(s => ({ id: s.id, exists: s.exists(), data: () => s.data() })),
      set: d => wrap(setDoc(ref, d)),
      update: d => wrap(updateDoc(ref, d)),
      delete: () => wrap(deleteDoc(ref)),
    };
  };
  const C = p => ({
    doc: id => D(p + "/" + id),
    get: () => wrap(getDocs(collection(fs, p))).then(q => ({ docs: q.docs.map(s => ({ id: s.id, exists: true, data: () => s.data() })) })),
  });

  const backendFor = user => ({
    use: async name => {
      if (name === "db") return { doc: D, collection: C };
      if (name === "user") return {
        id: async () => user.uid,
        can: async () => true,
        isOwner: async () => { try { return (await getDoc(doc(fs, "admins/" + user.uid))).exists(); } catch { return false; } },
      };
      return null;
    },
  });

  let firstAnswer = true;
  const skipped = () => { try { return localStorage.getItem("lane4-skip-account") === "1"; } catch { return false; } };

  // Emails are never shown on screen. We only say how someone signed in.
  const maskEmail = e => { const [n, d] = String(e || "").split("@"); return n && d ? `${n[0]}•••@${d}` : "your email"; };
  const via = u => (u.providerData[0] && u.providerData[0].providerId === "google.com") ? "Google" : "email";
  function updateAccountBox(user) {
    $("acctLine").textContent = user ? (user.emailVerified ? `Signed in with ${via(user)}. Your data saves to your account.` : "Signed in, but your email isn’t verified yet.") : "Not signed in. Your data saves on this device only.";
    $("acctSignIn").hidden = !!user; $("acctSignOut").hidden = !user; $("acctDelete").hidden = !user;
  }

  onAuthStateChanged(auth, async user => {
    updateAccountBox(user);
    const ok = user && user.emailVerified;
    window.__lane4.backend = ok ? backendFor(user) : null;
    if (firstAnswer) { firstAnswer = false; window.__lane4.resolveReady(window.__lane4.backend); }
    else if (ok) {
      // Signed in after the page loaded: connect cloud save and Rankings now.
      window.claude = { use: n => window.__lane4.backend.use(n) };
      try { await initCloud(); } catch {}
    }
    if (user && !user.emailVerified) showVerify(user);
    else if (!user && !skipped()) { gate.hidden = false; showForm(); }
    else gate.hidden = true;
  });

  // ---------- sign in / create account ----------
  const mode = () => document.querySelector('input[name=amode]:checked').value;
  document.querySelectorAll('input[name=amode]').forEach(r => r.addEventListener("change", () => {
    const up = mode() === "up";
    $("upOnly").hidden = !up; $("aGo").textContent = up ? "Create account" : "Sign in"; $("aForgot").hidden = up;
    $("aPass").autocomplete = up ? "new-password" : "current-password"; $("aMsg").textContent = "";
  }));
  function showForm() { $("authForm").hidden = false; $("authVerify").hidden = true; $("authSub").textContent = "Sign in to save your data to your account and use Rankings."; }
  function showVerify(user) {
    gate.hidden = false; $("authForm").hidden = true; $("authVerify").hidden = false;
    $("vEmail").textContent = maskEmail(user.email); $("authSub").textContent = "One more step: verify your email.";
  }
  const friendly = e => ({
    "auth/invalid-email": "That email doesn’t look right.",
    "auth/missing-password": "Enter your password.",
    "auth/weak-password": "Use at least 8 characters.",
    "auth/email-already-in-use": "There’s already an account with that email. Try signing in.",
    "auth/invalid-credential": "Email or password is wrong.",
    "auth/too-many-requests": "Too many tries. Wait a minute and try again.",
    "auth/account-exists-with-different-credential": "That email already has a Lane 4 account. Sign in with email instead.",
    "auth/unauthorized-domain": "This website isn’t approved for Google sign-in yet (see README step 5).",
  }[e && e.code] || "Something went wrong. Try again.");

  $("aGo").onclick = async () => {
    const email = $("aEmail").value.trim(), pass = $("aPass").value, msg = $("aMsg");
    msg.textContent = "";
    try {
      if (mode() === "up") {
        if (pass.length < 8) { msg.textContent = "Use at least 8 characters."; return; }
        if (pass !== $("aPass2").value) { msg.textContent = "Passwords don’t match."; return; }
        if (!$("aAge").checked) { msg.textContent = "You need to be 13 or older to create an account."; return; }
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await sendEmailVerification(cred.user);
        showVerify(cred.user);
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
      }
      try { localStorage.removeItem("lane4-skip-account"); } catch {}
    } catch (e) { msg.textContent = friendly(e); }
  };
  // Google sign-in: Google checks the password (and 2-step verification), Lane 4 never sees it.
  const google = new GoogleAuthProvider();
  google.setCustomParameters({ prompt: "select_account" });
  getRedirectResult(auth).catch(e => { $("aMsg").textContent = friendly(e); });
  $("gGo").onclick = async () => {
    $("aMsg").textContent = "";
    try { await signInWithPopup(auth, google); try { localStorage.removeItem("lane4-skip-account"); } catch {} }
    catch (e) {
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e && e.code)) {
        await signInWithRedirect(auth, google);
      } else if (!["auth/popup-closed-by-user"].includes(e && e.code)) $("aMsg").textContent = friendly(e);
    }
  };
  $("aForgot").onclick = async () => {
    const email = $("aEmail").value.trim();
    if (!email) { $("aMsg").textContent = "Type your email first, then tap Forgot password."; return; }
    try { await sendPasswordResetEmail(auth, email); $("aMsg").textContent = "Check your email for a reset link."; }
    catch (e) { $("aMsg").textContent = friendly(e); }
  };
  $("vDone").onclick = async () => {
    const u = auth.currentUser; if (!u) return;
    await reload(u);
    if (u.emailVerified) {
      gate.hidden = true; updateAccountBox(u);
      window.__lane4.backend = backendFor(u);
      window.claude = { use: n => window.__lane4.backend.use(n) };
      try { await initCloud(); } catch {}
      toast("You’re verified");
    } else $("vMsg").textContent = "Not verified yet. Open the link in the email, then try again.";
  };
  $("vResend").onclick = async () => {
    try { await sendEmailVerification(auth.currentUser); $("vMsg").textContent = "Sent again. Check spam too."; }
    catch (e) { $("vMsg").textContent = friendly(e); }
  };
  $("aSkip").onclick = async () => {
    try { localStorage.setItem("lane4-skip-account", "1"); } catch {}
    if (auth.currentUser && !auth.currentUser.emailVerified) await signOut(auth);
    gate.hidden = true;
  };
  $("acctSignIn").onclick = () => { document.querySelectorAll(".sheet").forEach(x => x.hidden = true); gate.hidden = false; showForm(); };
  $("acctSignOut").onclick = async () => { await signOut(auth); location.reload(); };

  // Delete account: two taps, removes cloud data and the login. Data on this device stays until Restart.
  let armed = false;
  $("acctDelete").onclick = async () => {
    const b = $("acctDelete");
    if (!armed) { armed = true; b.textContent = "Tap again to delete your account"; b.classList.add("danger"); setTimeout(() => { armed = false; b.textContent = "Delete my account"; b.classList.remove("danger"); }, 4000); return; }
    const u = auth.currentUser; if (!u) return;
    try {
      const paths = [`data/users/${u.uid}/lane4`, `subs/${u.uid}`, `optout/${u.uid}`];
      // Team records: the athlete's spot on a team, and a team they coach. S is the app's saved data.
      try { if (S && S.team) paths.push(`teams/${S.team.id}/members/${u.uid}`); if (S && S.coach) paths.push(`teams/${S.coach.id}`); } catch {}
      for (const p of paths) { try { await deleteDoc(doc(fs, p)); } catch {} }
      try { await deleteUser(u); }
      catch (e) {
        if (e && e.code === "auth/requires-recent-login" && via(u) === "Google") { await reauthenticateWithPopup(u, google); await deleteUser(u); }
        else throw e;
      }
      toast("Account deleted"); location.reload();
    } catch (e) {
      toast(e && e.code === "auth/requires-recent-login" ? "For safety, sign out, sign back in, then delete." : "Couldn’t delete right now.");
    }
  };
}
