// Acces a Firebase : connexion avec un compte Google et base Firestore partagee par le groupe.
// Firestore garde une copie locale : l'application fonctionne hors connexion et
// envoie les modifications des que le reseau revient.
import { firebaseConfig } from './firebase-config.js';

export const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';

let fb = null; // { auth, db, a: module auth, f: module firestore }

export const isConfigured = () => Boolean(firebaseConfig?.apiKey) && !firebaseConfig.apiKey.startsWith('A_REMPLIR');

export async function init() {
  const [appMod, a, f] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  let db;
  try {
    db = f.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }),
    });
  } catch {
    db = f.initializeFirestore(app, { ignoreUndefinedProperties: true });
  }
  const auth = a.getAuth(app);
  fb = { auth, db, a, f };
  // Termine une connexion commencee par redirection (si la fenetre surgissante etait bloquee)
  a.getRedirectResult(auth).catch(() => {});
}

// --- Compte Google ---

export const onUser = (callback) => fb.a.onAuthStateChanged(fb.auth, callback);

export async function signIn() {
  const provider = new fb.a.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await fb.a.signInWithPopup(fb.auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await fb.a.signInWithRedirect(fb.auth, provider);
      return;
    }
    throw e;
  }
}

export const signOut = () => fb.a.signOut(fb.auth);

// --- Base de donnees ---

const ref = (col, id) => fb.f.doc(fb.db, col, id);

// callback(data | null). Tant que seul le cache local repond "absent", on attend le serveur.
export function watchDoc(col, id, callback, onError) {
  return fb.f.onSnapshot(
    ref(col, id),
    (snap) => {
      if (snap.exists()) callback({ id: snap.id, ...snap.data() });
      else if (!snap.metadata.fromCache) callback(null);
    },
    onError,
  );
}

// Lecture ponctuelle ; null si absent ou interdit
export async function getDoc(col, id) {
  try {
    const snap = await fb.f.getDoc(ref(col, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch {
    return null;
  }
}

// callback(liste de documents { id, ...donnees })
export function watchCollection(col, callback, onError) {
  return fb.f.onSnapshot(
    fb.f.collection(fb.db, col),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

// ops : [{ type: 'set' | 'update' | 'delete', col, id, data }]
// La promesse se resout quand le serveur a confirme (jamais hors connexion) :
// l'appelant ne l'attend que si c'est necessaire. Les donnees locales sont mises a jour tout de suite.
export function write(ops) {
  const batch = fb.f.writeBatch(fb.db);
  for (const op of ops) {
    if (op.type === 'set') batch.set(ref(op.col, op.id), op.data);
    else if (op.type === 'update') batch.update(ref(op.col, op.id), op.data);
    else batch.delete(ref(op.col, op.id));
  }
  return batch.commit();
}
