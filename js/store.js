// Donnees partagees (Firestore) + quelques reglages propres au telephone (localStorage).
//
// Collections Firestore :
//   config/group               : { admins: [e-mails] } ; cree dans la console Firebase
//   sports/{id}                : { name, icon, lowerWins } ; communs a tous les groupes
//   groups/{gid}               : { name, code, owner, roster: { uid: { email, name, removed } }, invites: [{ email, pid }] }
//                                owner = responsable (createur) ; roster = membres, visibles par le responsable
//   groups/{gid}/players/{pid} : { name, uid, email, mergedInto, createdBy }
//                                uid = compte relie ; email = seul ce compte peut le revendiquer ; mergedInto = fusionne
//   groups/{gid}/games/{id}    : { date, sport, location, comments, players: [{ pid, score }], pids, createdBy, createdByName, createdAt, updatedAt }
//   joinCodes/{code}           : { group } ; code d'entree -> groupe
//   members/{uid}              : { email, name, joinedAt, groups: [gid], pids: { gid: pid }, removed: [gid], revoked }
//   invites/{e-mail}           : { groups: { gid: pid } } ; joueurs attribues a un e-mail par un responsable ou un administrateur
//
// Une meme personne a un joueur par groupe. Pour les stats sur plusieurs groupes, un joueur est identifie par sa
// "cle" : 'u:<compte>' s'il est relie a un compte (le meme dans tous les groupes), sinon 'p:<groupe>:<joueur>'.
// Les ecrans travaillent sur des parties "vues par un joueur" : { ...partie, me: score, opponents: [{ name, score }] }.
import * as cloud from './cloud.js';

const LOCAL = { draft: 'sl.draft', day: 'sl.day', migrated: 'sl.migrated2' };
// Anciennes donnees, quand tout etait stocke sur le telephone
const LEGACY = { me: 'sl.me', sports: 'sl.sports', players: 'sl.players', games: 'sl.games' };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // non critique
  }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const byName = (a, b) => a.localeCompare(b, 'fr');
const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const playersPath = (gid) => `groups/${gid}/players`;
const gamesPath = (gid) => `groups/${gid}/games`;

// ---------------------------------------------------------------------------
// Etat local et synchronisation
// ---------------------------------------------------------------------------

const data = {
  sports: new Map(),
  groups: new Map(), // gid -> { id, name, code }
  players: new Map(), // gid -> Map(pid -> joueur)
  games: new Map(), // gid -> Map(id -> partie)
};
// Lus seulement par les administrateurs
const admin = { members: new Map() };
let config = null;
const session = { uid: null, user: null, member: null };
const handlers = { change: () => {}, error: (e) => console.error(e) };

export function setHandlers({ change, error }) {
  if (change) handlers.change = change;
  if (error) handlers.error = error;
}

export function setSession(user, member) {
  session.uid = user?.uid || null;
  session.user = user || null;
  session.member = member || null;
}

const myEmail = () => (session.user?.email || '').toLowerCase();

export const account = () => ({ email: session.user?.email || '', name: session.user?.displayName || '' });

export const isAdmin = () => Boolean(myEmail()) && (config?.admins || []).some((e) => String(e).toLowerCase() === myEmail());

export const watchMember = (userId, callback, onError) => cloud.watchDoc('members', userId, callback, onError);

// Ecouteurs actifs : cle -> fonction d'arret
const watchers = new Map();
let sync = null; // { pending: Set, ready: boolean, onReady }

function listen(key, start) {
  if (watchers.has(key)) return;
  if (sync && !sync.ready) sync.pending.add(key);
  watchers.set(key, start(() => loaded(key)));
}

function unlisten(key) {
  watchers.get(key)?.();
  watchers.delete(key);
  sync?.pending.delete(key);
}

// Premier resultat d'un ecouteur ; une fois tout charge, onReady, puis handlers.change a chaque modification
function loaded(key) {
  if (!sync) return;
  if (!sync.ready) {
    sync.pending.delete(key);
    if (!sync.pending.size) {
      sync.ready = true;
      sync.onReady();
    }
  } else handlers.change();
}

const fail = (e) => handlers.error(e);

// Groupes visibles : tous pour un administrateur, sinon ceux du membre
function visibleGroups() {
  return isAdmin() ? [...data.groups.keys()] : session.member?.groups || [];
}

// Ajuste les ecouteurs aux groupes visibles (appele quand le membre ou la liste des groupes change)
export function refreshGroups() {
  if (!sync) return;
  if (isAdmin()) {
    listen('groups', (done) =>
      cloud.watchCollection(
        'groups',
        (docs) => {
          data.groups = new Map(docs.map((d) => [d.id, d]));
          refreshGroups();
          done();
        },
        fail,
      ),
    );
    for (const col of ['members']) {
      listen(col, (done) =>
        cloud.watchCollection(
          col,
          (docs) => {
            admin[col] = new Map(docs.map((d) => [d.id, d]));
            done();
          },
          fail,
        ),
      );
    }
  }
  const wanted = new Set(visibleGroups());
  for (const gid of wanted) {
    if (!isAdmin()) {
      listen(`group:${gid}`, (done) =>
        cloud.watchDoc(
          'groups',
          gid,
          (doc) => {
            if (doc) data.groups.set(gid, doc);
            else data.groups.delete(gid);
            done();
          },
          () => done(),
        ),
      );
    }
    for (const [kind, path] of [
      ['players', playersPath(gid)],
      ['games', gamesPath(gid)],
    ]) {
      listen(`${kind}:${gid}`, (done) =>
        cloud.watchCollection(
          path,
          (docs) => {
            data[kind].set(gid, new Map(docs.map((d) => [d.id, d])));
            done();
          },
          (e) => {
            fail(e);
            done();
          },
        ),
      );
    }
  }
  // Groupes quittes : on arrete d'ecouter et on oublie leurs donnees
  for (const key of [...watchers.keys()]) {
    const [kind, gid] = key.split(':');
    if (gid && !wanted.has(gid)) {
      unlisten(key);
      data[kind === 'group' ? 'groups' : kind]?.delete(gid);
    }
  }
  if (!isAdmin()) {
    for (const col of ['groups', 'members']) unlisten(col);
  }
}

// onReady : appele une fois que la configuration, les sports et les groupes visibles ont repondu
export function startSync(onReady) {
  sync = { pending: new Set(), ready: false, onReady };
  listen('config', (done) =>
    cloud.watchDoc(
      'config',
      'group',
      (doc) => {
        config = doc;
        refreshGroups();
        done();
      },
      () => done(),
    ),
  );
  listen('sports', (done) =>
    cloud.watchCollection(
      'sports',
      (docs) => {
        data.sports = new Map(docs.map((d) => [d.id, d]));
        done();
      },
      fail,
    ),
  );
  refreshGroups();
  return () => {
    for (const key of [...watchers.keys()]) unlisten(key);
    sync = null;
    config = null;
    data.sports = new Map();
    data.groups = new Map();
    data.players = new Map();
    data.games = new Map();
    admin.members = new Map();
  };
}

// Map locale correspondant a une collection Firestore
function localMap(col) {
  if (col === 'sports' || col === 'groups') return data[col];
  if (col === 'members') return admin.members;
  const m = col.match(/^groups\/([^/]+)\/(players|games)$/);
  if (!m) return null;
  const [, gid, kind] = m;
  if (!data[kind].has(gid)) data[kind].set(gid, new Map());
  return data[kind].get(gid);
}

// Applique les modifications tout de suite en local, puis les envoie.
// Si le serveur refuse, Firestore annule et l'ecran se remet a jour tout seul.
function commit(ops) {
  for (const op of ops) {
    const map = localMap(op.col);
    // Operations ciblees ("a.b", ajout a une liste...) : on attend la reponse de Firestore, deja tres rapide en local
    const targeted = op.type === 'merge' || (op.data && Object.entries(op.data).some(([k, v]) => k.includes('.') || v?.__t));
    if (!map || targeted) continue;
    if (op.type === 'set') map.set(op.id, { id: op.id, ...op.data });
    else if (op.type === 'update') map.set(op.id, { ...map.get(op.id), ...op.data });
    else map.delete(op.id);
  }
  const done = cloud.write(ops);
  done.catch((e) => handlers.error(e));
  return done;
}

// Pour les gros envois (import) : par paquets, en attendant la confirmation du serveur
async function commitInChunks(ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) await commit(ops.slice(i, i + size));
}

// ---------------------------------------------------------------------------
// Groupes
// ---------------------------------------------------------------------------

// Operations ciblees (voir cloud.write)
const T = {
  union: (...v) => ({ __t: 'union', v }),
  remove: (...v) => ({ __t: 'remove', v }),
  del: () => ({ __t: 'del' }),
};

// Responsable du groupe (celui qui l'a cree) ou administrateur : peut gerer le groupe
export const canManage = (gid) => isAdmin() || (Boolean(session.uid) && data.groups.get(gid)?.owner === session.uid && !session.member?.revoked);

// Peut creer un groupe : administrateur, ou membre d'au moins un groupe
export const canCreateGroup = () => isAdmin() || (session.member?.groups || []).length > 0;

// Groupes que je vois : { id, name, code, mine (j'en suis membre), pid (mon joueur), manage (je le gere), ownerName }
export function getGroups() {
  const mine = new Set(session.member?.groups || []);
  return visibleGroups()
    .map((gid) => {
      const g = data.groups.get(gid);
      return {
        id: gid,
        name: g?.name || '…',
        code: g?.code || '',
        mine: mine.has(gid),
        pid: myPid(gid),
        manage: canManage(gid),
        ownerName: g?.roster?.[g?.owner]?.name || '',
      };
    })
    .sort((a, b) => byName(a.name, b.name));
}

export const groupName = (gid) => data.groups.get(gid)?.name || '…';

// Groupes ou je peux saisir : ceux dont je suis membre avec un joueur, et ceux que je gere
export const writableGroups = () => getGroups().filter((g) => g.manage || (g.mine && g.pid));

// Groupes dont je suis membre mais ou je n'ai pas encore choisi mon joueur
export const groupsWithoutPlayer = () => getGroups().filter((g) => g.mine && !g.pid);

// ---------------------------------------------------------------------------
// Rejoindre un groupe (attend le serveur)
// ---------------------------------------------------------------------------

// Ecrit le membre en ajoutant un groupe (la regle verifie le code, l'invitation ou le role d'administrateur)
function addGroupToMember(gid, joinCode = '') {
  const u = session.user;
  const m = session.member;
  const groups = [...new Set([...(m?.groups || []), ...(gid ? [gid] : [])])];
  const ops = m
    ? [{ type: 'update', col: 'members', id: u.uid, data: { groups, joining: gid, joinCode } }]
    : [
        {
          type: 'set',
          col: 'members',
          id: u.uid,
          data: { email: myEmail(), name: u.displayName || '', joinedAt: new Date().toISOString(), groups, pids: {}, removed: [], revoked: false, joining: gid || null, joinCode },
        },
      ];
  // Je m'inscris dans la liste des membres du groupe (visible par son responsable)
  if (gid) ops.push({ type: 'update', col: 'groups', id: gid, data: { [`roster.${u.uid}`]: rosterEntry() } });
  return cloud.write(ops);
}

const rosterEntry = () => ({ email: myEmail(), name: session.user?.displayName || '', removed: false });

export async function joinWithCode(code) {
  const clean = code.trim();
  if (!clean) throw new Error('Saisis le code du groupe.');
  const entry = await cloud.getDoc('joinCodes', clean);
  if (!entry?.group) throw new Error('Code incorrect.');
  if (session.member?.groups?.includes(entry.group)) throw new Error('Tu fais déjà partie de ce groupe.');
  await addGroupToMember(entry.group, clean);
}

// Premiere connexion : invitations a mon e-mail, administrateur ?
// Rejoint les groupes ou je suis invite (un par un, comme l'exigent les regles). Renvoie true si je suis entre.
export async function joinWithoutCode() {
  const [invite, cfg] = await Promise.all([cloud.getDoc('invites', myEmail()), cloud.getDoc('config', 'group')]);
  if (cfg) config = cfg;
  const invited = Object.keys(invite?.groups || {}).filter((gid) => !session.member?.groups?.includes(gid));
  if (!invited.length && !isAdmin()) return false;
  if (!invited.length) {
    await addGroupToMember(null);
    return true;
  }
  for (const gid of invited) {
    await addGroupToMember(gid);
    session.member = { ...(session.member || {}), groups: [...(session.member?.groups || []), gid], pids: session.member?.pids || {} };
  }
  return true;
}

// ---------------------------------------------------------------------------
// Joueurs (propres a chaque groupe)
// ---------------------------------------------------------------------------

const playersOf = (gid) => data.players.get(gid) || new Map();

// Suit les fusions jusqu'au joueur final
function resolve(gid, pid) {
  let id = pid;
  for (let i = 0; i < 20; i += 1) {
    const next = playersOf(gid).get(id)?.mergedInto;
    if (!next) break;
    id = next;
  }
  return id;
}

const nameOf = (gid, pid) => playersOf(gid).get(resolve(gid, pid))?.name || '?';

function keyOf(gid, pid) {
  const id = resolve(gid, pid);
  const p = playersOf(gid).get(id);
  return p?.uid ? `u:${p.uid}` : `p:${gid}:${id}`;
}

const activePlayers = (gid) => [...playersOf(gid).values()].filter((p) => !p.mergedInto && typeof p.name === 'string');
const findPlayer = (gid, name) => {
  const n = normalize(name);
  return activePlayers(gid).find((p) => normalize(p.name) === n) || null;
};

export const myKey = () => (session.uid ? `u:${session.uid}` : null);
export const myPid = (gid) => session.member?.pids?.[gid] || null;

// Mon nom de joueur dans un groupe (ou dans le premier groupe ou j'en ai un)
export function getMe(gid) {
  if (gid && myPid(gid)) return nameOf(gid, myPid(gid));
  const any = Object.entries(session.member?.pids || {}).find(([g]) => data.players.has(g));
  return any ? nameOf(any[0], any[1]) : session.user?.displayName?.split(' ')[0] || '';
}

export const pidOf = (gid, name) => findPlayer(gid, name)?.id || null;

export function getPlayers(gid) {
  return activePlayers(gid)
    .map((p) => p.name)
    .sort(byName);
}

// Pour les reglages : { pid, name, linked, mine, email }
export function getPlayerDetails(gid) {
  return activePlayers(gid)
    .map((p) => ({ pid: p.id, name: p.name, linked: Boolean(p.uid), mine: p.uid === session.uid, email: p.email || '' }))
    .sort((a, b) => byName(a.name, b.name));
}

// Joueurs que je peux revendiquer : pas encore relies a un compte, ni attribues a un autre e-mail
export const unclaimedPlayers = (gid) => getPlayerDetails(gid).filter((p) => !p.linked && (!p.email || p.email === myEmail()));

// Joueur qu'un administrateur m'a attribue (par mon e-mail)
export const assignedPlayer = (gid) => getPlayerDetails(gid).find((p) => !p.linked && p.email && p.email === myEmail()) || null;

// Trouve le joueur par son nom dans le groupe, ou le cree (operation ajoutee a ops)
function ensurePlayer(gid, name, ops) {
  const clean = name.trim();
  const found = findPlayer(gid, clean);
  if (found) return found.id;
  const id = uid();
  const player = { name: clean, uid: null, email: null, mergedInto: null, createdBy: session.uid };
  localMap(playersPath(gid)).set(id, { id, ...player });
  ops.push({ type: 'set', col: playersPath(gid), id, data: player });
  return id;
}

export function addPlayer(gid, name) {
  if (!name.trim()) return;
  const ops = [];
  ensurePlayer(gid, name, ops);
  if (ops.length) commit(ops);
}

// Renomme le joueur. Si le nouveau nom existe deja dans le groupe, les deux joueurs sont fusionnes.
export function renamePlayer(gid, from, to) {
  const clean = to.trim();
  const player = findPlayer(gid, from);
  if (!clean || !player || clean === player.name) return;
  const target = findPlayer(gid, clean);
  if (target && target.id !== player.id) {
    if (player.uid) throw new Error(`« ${player.name} » est relié à un compte : renomme plutôt « ${target.name} » en « ${player.name} ».`);
    commit([{ type: 'update', col: playersPath(gid), id: player.id, data: { mergedInto: target.id } }]);
    return;
  }
  if (player.uid && player.uid !== session.uid && !canManage(gid)) throw new Error(`« ${player.name} » est relié au compte d'un autre membre : lui seul peut changer son nom.`);
  commit([{ type: 'update', col: playersPath(gid), id: player.id, data: { name: clean } }]);
}

// Impossible s'il apparait dans une partie ou s'il est relie a un compte (verifie par l'interface)
export function removePlayer(gid, name) {
  const player = findPlayer(gid, name);
  if (player && !player.uid) commit([{ type: 'delete', col: playersPath(gid), id: player.id }]);
}

// Me relier a un joueur du groupe (existant ou cree) ; la regle exige le champ "linking"
function linkMe(gid, pid, ops) {
  const pids = { ...(session.member?.pids || {}), [gid]: pid };
  ops.push({ type: 'update', col: playersPath(gid), id: pid, data: { uid: session.uid } });
  ops.push({ type: 'update', col: 'members', id: session.uid, data: { pids, linking: gid } });
  return commit(ops);
}

export const claimPlayer = (gid, pid) => linkMe(gid, pid, []);

export function createMyPlayer(gid, name) {
  const clean = name.trim();
  if (!clean) return Promise.reject(new Error('Donne ton nom de joueur.'));
  if (findPlayer(gid, clean)) return Promise.reject(new Error(`« ${clean} » existe déjà : choisis-le dans la liste.`));
  const id = uid();
  const ops = [{ type: 'set', col: playersPath(gid), id, data: { name: clean, uid: null, email: null, mergedInto: null, createdBy: session.uid } }];
  return linkMe(gid, id, ops);
}

// ---------------------------------------------------------------------------
// Gestion des groupes : par leur responsable ou un administrateur (verifie par le serveur)
// ---------------------------------------------------------------------------

// Cree un groupe dont je deviens le responsable et un membre
export async function createGroup(name, code) {
  const cleanName = name.trim();
  const cleanCode = code.trim();
  if (!cleanName) throw new Error('Donne un nom au groupe.');
  if (!cleanCode) throw new Error('Choisis un code pour le groupe.');
  if (/[/]/.test(cleanCode)) throw new Error('Le code ne peut pas contenir « / ».');
  if (!canCreateGroup()) throw new Error('Rejoins d’abord un groupe pour pouvoir en créer.');
  if (await cloud.getDoc('joinCodes', cleanCode)) throw new Error('Ce code est déjà utilisé par un autre groupe.');
  const gid = uid();
  await commit([
    {
      type: 'set',
      col: 'groups',
      id: gid,
      data: { name: cleanName, code: cleanCode, owner: session.uid, roster: { [session.uid]: rosterEntry() }, invites: [], createdAt: new Date().toISOString() },
    },
    { type: 'set', col: 'joinCodes', id: cleanCode, data: { group: gid } },
    { type: 'update', col: 'members', id: session.uid, data: { groups: T.union(gid), joining: gid, joinCode: cleanCode } },
  ]);
  return gid;
}

export function renameGroup(gid, name) {
  if (!name.trim()) throw new Error('Donne un nom au groupe.');
  commit([{ type: 'update', col: 'groups', id: gid, data: { name: name.trim() } }]);
}

export async function setGroupCode(gid, code) {
  const clean = code.trim();
  if (!clean) throw new Error('Le code ne peut pas être vide.');
  if (/[/]/.test(clean)) throw new Error('Le code ne peut pas contenir « / ».');
  const group = data.groups.get(gid);
  if (group?.code === clean) return;
  if (await cloud.getDoc('joinCodes', clean)) throw new Error('Ce code est déjà utilisé par un autre groupe.');
  const ops = [
    { type: 'update', col: 'groups', id: gid, data: { code: clean } },
    { type: 'set', col: 'joinCodes', id: clean, data: { group: gid } },
  ];
  if (group?.code) ops.push({ type: 'delete', col: 'joinCodes', id: group.code });
  await commit(ops);
}

// Joueur d'un membre dans un groupe (celui qui est relie a son compte)
const playerOfUser = (gid, userId) => activePlayers(gid).find((p) => p.uid === userId) || null;

// Membres d'un groupe : [{ uid, email, name, removed, playerName, owner, me }]
export function getGroupMembers(gid) {
  const g = data.groups.get(gid);
  return Object.entries(g?.roster || {})
    .map(([id, r]) => ({
      uid: id,
      email: r.email || '',
      name: r.name || '',
      removed: Boolean(r.removed),
      playerName: playerOfUser(gid, id)?.name || '',
      owner: id === g.owner,
      me: id === session.uid,
    }))
    .sort((a, b) => Number(a.removed) - Number(b.removed) || byName(a.playerName || a.email, b.playerName || b.email));
}

// Retire un membre du groupe : il ne pourra pas y revenir avec le code ; son joueur redevient libre
export function removeFromGroup(memberUid, gid) {
  if (memberUid === session.uid) throw new Error('Tu ne peux pas te retirer toi-même.');
  if (memberUid === data.groups.get(gid)?.owner && !isAdmin()) throw new Error('Le responsable ne peut pas être retiré.');
  const ops = [];
  const player = playerOfUser(gid, memberUid);
  if (player) ops.push({ type: 'update', col: playersPath(gid), id: player.id, data: { uid: null } });
  ops.push({
    type: 'update',
    col: 'members',
    id: memberUid,
    data: { groups: T.remove(gid), removed: T.union(gid), [`pids.${gid}`]: T.del(), managing: gid },
  });
  ops.push({ type: 'update', col: 'groups', id: gid, data: { [`roster.${memberUid}.removed`]: true } });
  commit(ops);
}

// Remet dans le groupe un membre retire
export function addToGroup(memberUid, gid) {
  commit([
    { type: 'update', col: 'members', id: memberUid, data: { groups: T.union(gid), removed: T.remove(gid), managing: gid } },
    { type: 'update', col: 'groups', id: gid, data: { [`roster.${memberUid}.removed`]: false } },
  ]);
}

// Relie un membre du groupe a un joueur (existant ou cree) ; son ancien joueur redevient libre
export function linkMember(memberUid, gid, playerName) {
  const existing = findPlayer(gid, playerName);
  if (existing?.uid && existing.uid !== memberUid) throw new Error(`« ${existing.name} » est déjà relié à un autre membre.`);
  const roster = data.groups.get(gid)?.roster?.[memberUid];
  const ops = [];
  const pid = ensurePlayer(gid, playerName, ops);
  const old = playerOfUser(gid, memberUid);
  if (old && old.id !== pid) ops.push({ type: 'update', col: playersPath(gid), id: old.id, data: { uid: null } });
  ops.push({ type: 'update', col: playersPath(gid), id: pid, data: { uid: memberUid, email: roster?.email || null } });
  ops.push({
    type: 'update',
    col: 'members',
    id: memberUid,
    data: { [`pids.${gid}`]: pid, groups: T.union(gid), removed: T.remove(gid), managing: gid },
  });
  ops.push({ type: 'update', col: 'groups', id: gid, data: { [`roster.${memberUid}.removed`]: false } });
  commit(ops);
}

// Membre du groupe ayant cet e-mail (pour relier directement au lieu d'inviter)
export const memberByEmail = (gid, email) => getGroupMembers(gid).find((m) => m.email.toLowerCase() === email.trim().toLowerCase()) || null;

// Invitations d'un groupe : [{ email, pid, playerName, joined }]
export function getGroupInvites(gid) {
  const g = data.groups.get(gid);
  const joined = new Set(Object.values(g?.roster || {}).filter((r) => !r.removed).map((r) => (r.email || '').toLowerCase()));
  return (g?.invites || [])
    .map((i) => ({ email: i.email, pid: i.pid, playerName: nameOf(gid, i.pid), joined: joined.has(i.email) }))
    .sort((a, b) => byName(a.email, b.email));
}

// Attribue un joueur du groupe (existant ou cree) a un e-mail : la personne entrera dans ce groupe sans code
export function inviteEmail(email, gid, playerName) {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(clean)) throw new Error('Adresse e-mail invalide.');
  if (!playerName.trim()) throw new Error('Choisis un nom de joueur.');
  const existing = findPlayer(gid, playerName);
  if (existing?.uid) throw new Error(`« ${existing.name} » est déjà relié à un compte.`);
  const ops = [];
  const pid = ensurePlayer(gid, playerName, ops);
  const invites = data.groups.get(gid)?.invites || [];
  const previous = invites.find((i) => i.email === clean);
  if (previous && previous.pid !== pid) ops.push({ type: 'update', col: playersPath(gid), id: previous.pid, data: { email: null } });
  ops.push({ type: 'update', col: playersPath(gid), id: pid, data: { email: clean } });
  ops.push({ type: 'merge', col: 'invites', id: clean, data: { groups: { [gid]: pid }, managing: gid } });
  ops.push({ type: 'update', col: 'groups', id: gid, data: { invites: [...invites.filter((i) => i.email !== clean), { email: clean, pid }] } });
  commit(ops);
}

export function removeInvite(email, gid) {
  const invites = data.groups.get(gid)?.invites || [];
  const invite = invites.find((i) => i.email === email);
  const ops = [
    { type: 'update', col: 'invites', id: email, data: { [`groups.${gid}`]: T.del(), managing: gid } },
    { type: 'update', col: 'groups', id: gid, data: { invites: invites.filter((i) => i.email !== email) } },
  ];
  const player = invite && playersOf(gid).get(invite.pid);
  if (player && !player.uid && player.email === email) ops.push({ type: 'update', col: playersPath(gid), id: player.id, data: { email: null } });
  commit(ops);
}

// ---------------------------------------------------------------------------
// Administration generale (administrateurs seulement)
// ---------------------------------------------------------------------------

// Tous les membres : { uid, name, email, revoked, me, groups: [noms des groupes] }
export function getMembers() {
  return [...admin.members.values()]
    .map((m) => ({
      uid: m.id,
      name: m.name || '',
      email: m.email || '',
      revoked: Boolean(m.revoked),
      me: m.id === session.uid,
      groups: (m.groups || []).map((gid) => groupName(gid)),
    }))
    .sort((a, b) => byName(a.name || a.email, b.name || b.email));
}

// Revoque (ou retablit) l'acces d'un membre a tous les groupes
export function setRevoked(memberUid, revoked) {
  if (memberUid === session.uid) throw new Error('Tu ne peux pas te révoquer toi-même.');
  commit([{ type: 'update', col: 'members', id: memberUid, data: { revoked } }]);
}

// ---------------------------------------------------------------------------
// Sports et jeux : { id, name, icon, lowerWins, titled } ; communs a tous les groupes
// titled : demander le nom du jeu a chaque partie (jeux de societe)
// ---------------------------------------------------------------------------

export function getSports() {
  return [...data.sports.values()].filter((s) => typeof s.name === 'string').sort((a, b) => byName(a.name, b.name));
}

export function saveSport(sport) {
  const saved = { id: sport.id || uid(), name: sport.name.trim(), icon: (sport.icon || '').trim() || '🏅', lowerWins: Boolean(sport.lowerWins), titled: Boolean(sport.titled) };
  const { id, ...fields } = saved;
  commit([{ type: 'set', col: 'sports', id, data: fields }]);
  return saved;
}

// Impossible si des parties utilisent ce sport (verifie par l'interface)
export function deleteSport(id) {
  commit([{ type: 'delete', col: 'sports', id }]);
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

// Partie avec son groupe et les noms des joueurs (fusions resolues)
function view(gid, g) {
  return {
    ...g,
    group: gid,
    players: (g.players || []).map((p) => ({ pid: resolve(gid, p.pid), key: keyOf(gid, p.pid), name: nameOf(gid, p.pid), score: p.score, team: p.team ?? null })),
  };
}

// Partie vue par un joueur (par sa cle), ou null s'il n'y a pas participe.
// Voir stats.js pour le format : me, opponents (avec team en mode equipes), teammates.
export function perspective(g, key) {
  const me = g.players.find((p) => p.key === key);
  if (!me) return null;
  const others = g.players.filter((p) => p !== me);
  if (g.mode === 'coop') {
    return { ...g, me: Number.isFinite(me.score) ? me.score : null, teammates: others.map((p) => p.name), opponents: [] };
  }
  if (g.mode === 'teams') {
    // Mon equipe porte le numero 0, les equipes adverses 1, 2... dans l'ordre d'apparition
    const numbers = new Map();
    for (const p of others) if (p.team !== me.team && !numbers.has(p.team)) numbers.set(p.team, numbers.size + 1);
    return {
      ...g,
      me: me.score,
      teammates: others.filter((p) => p.team === me.team).map((p) => p.name),
      opponents: others.filter((p) => p.team !== me.team).map((p) => ({ name: p.name, score: p.score, team: numbers.get(p.team) })),
    };
  }
  return { ...g, me: me.score, teammates: [], opponents: others.map(({ name, score }) => ({ name, score })) };
}

// Toutes les parties visibles ; groupId : un seul groupe, ou '' pour tous
export function getAllGames(groupId = '') {
  const list = [];
  for (const [gid, games] of data.games) {
    if (groupId && gid !== groupId) continue;
    for (const g of games.values()) if (Array.isArray(g.players)) list.push(view(gid, g));
  }
  return list;
}

// Parties d'un joueur (moi par defaut), de son point de vue
export function getGames(key = myKey(), groupId = '') {
  if (!key) return [];
  return getAllGames(groupId)
    .map((g) => perspective(g, key))
    .filter(Boolean);
}

// Joueurs presents dans des parties : [{ key, name }] (pour choisir les stats a afficher)
export function getPlayerKeys(groupId = '') {
  const map = new Map();
  for (const g of getAllGames(groupId)) for (const p of g.players) if (!map.has(p.key)) map.set(p.key, p.name);
  return [...map.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => byName(a.name, b.name));
}

// Meme regle que firestore.rules : l'auteur, les joueurs de la partie, le responsable du groupe et les administrateurs
export function canEdit(g) {
  return canManage(g.group) || g.createdBy === session.uid || (g.pids || []).includes(myPid(g.group));
}

// record : partie "vue par un joueur" (voir stats.js) + { id, group, createdAt, owner }
//   mode, me, opponents: [{ name, score, team }], teammates: [nom], result, title, location, comments
// owner : joueur dont "me" est le score (moi par defaut ; le responsable ou un administrateur peut saisir pour un autre)
export function saveGame(record) {
  const gid = record.group;
  if (!gid) throw new Error('Choisis le groupe.');
  const ops = [];
  const ownerPid = record.owner ? ensurePlayer(gid, record.owner, ops) : myPid(gid);
  if (!ownerPid) throw new Error(`Choisis d’abord ton joueur dans « ${groupName(gid)} », ou saisis la partie pour un autre joueur.`);
  const mode = record.mode === 'teams' || record.mode === 'coop' ? record.mode : null;
  const myScore = Number.isFinite(record.me) ? record.me : null;
  // Mon camp (moi + coequipiers) : equipe 0 avec le score de l'equipe ; adversaires : leur equipe en mode equipes
  const players = [
    { pid: ownerPid, score: myScore, ...(mode ? { team: 0 } : {}) },
    ...(mode ? record.teammates || [] : []).map((name) => ({ pid: ensurePlayer(gid, name, ops), score: myScore, team: 0 })),
    ...(mode === 'coop' ? [] : record.opponents).map((o) => ({ pid: ensurePlayer(gid, o.name, ops), score: o.score, ...(mode === 'teams' ? { team: o.team } : {}) })),
  ];
  // Partie deplacee vers un autre groupe : on la retire de l'ancien
  const fromGroup = record.id ? [...data.games.keys()].find((g) => data.games.get(g).has(record.id)) : null;
  const previous = fromGroup ? data.games.get(fromGroup).get(record.id) : null;
  if (fromGroup && fromGroup !== gid) ops.push({ type: 'delete', col: gamesPath(fromGroup), id: record.id });
  const now = new Date().toISOString();
  const id = record.id || uid();
  const game = {
    date: record.date,
    sport: record.sport,
    title: (record.title || '').trim(),
    mode,
    result: mode === 'coop' ? record.result : null,
    location: record.location || '',
    comments: record.comments || '',
    players,
    pids: players.map((p) => p.pid),
    createdBy: previous?.createdBy || session.uid,
    createdByName: previous?.createdByName || getMe(gid),
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
  ops.push({ type: 'set', col: gamesPath(gid), id, data: game });
  commit(ops);
  return view(gid, { id, ...game });
}

// Noms de jeux deja saisis pour un sport (suggestions), les plus joues d'abord
export function getTitles(sportId) {
  const count = new Map();
  for (const g of getAllGames()) {
    const t = (g.title || '').trim();
    if (g.sport === sportId && t) count.set(t, (count.get(t) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || byName(a[0], b[0])).map(([t]) => t);
}

export function deleteGame(gid, id) {
  commit([{ type: 'delete', col: gamesPath(gid), id }]);
}

// ---------------------------------------------------------------------------
// Sauvegarde et import des anciennes donnees (format "telephone", version 1)
// ---------------------------------------------------------------------------

export function exportBackup() {
  const groups = [...data.groups.values()].map((g) => ({
    ...g,
    players: [...playersOf(g.id).values()],
    games: [...(data.games.get(g.id) || new Map()).values()],
  }));
  return { app: 'score-logger', version: 3, exportedAt: new Date().toISOString(), sports: [...data.sports.values()], groups };
}

// Parties encore stockees sur ce telephone et pas encore envoyees
export function legacyBackup() {
  if (read(LOCAL.migrated, false)) return null;
  const games = read(LEGACY.games, []);
  if (!Array.isArray(games) || !games.length) return null;
  return { me: read(LEGACY.me, ''), sports: read(LEGACY.sports, []), players: read(LEGACY.players, []), games };
}

export const legacyName = () => read(LEGACY.me, '');
export const markMigrated = () => writeLocal(LOCAL.migrated, true);

// Envoie dans un groupe des parties au format version 1 (fichier JSON ou anciennes donnees du telephone).
// Dans ces parties, "me" est mon joueur dans ce groupe. Les sports et joueurs sont rapproches par leur nom.
export async function importLegacy(backup, gid) {
  if (backup?.version >= 2) throw new Error('Ce fichier est une sauvegarde complète : il sert d’archive et ne se réimporte pas.');
  if (!backup || !Array.isArray(backup.games)) throw new Error('Fichier invalide : liste "games" absente');
  if (!gid) throw new Error('Choisis le groupe.');
  if (!myPid(gid)) throw new Error(`Choisis d’abord ton joueur dans « ${groupName(gid)} ».`);
  const ops = [];

  const sportIds = new Map();
  for (const s of backup.sports || []) {
    if (!s || !s.id || typeof s.name !== 'string' || !s.name.trim()) continue;
    const same = getSports().find((x) => normalize(x.name) === normalize(s.name)) || data.sports.get(s.id);
    if (same) sportIds.set(s.id, same.id);
    else {
      const sport = { name: s.name.trim(), icon: s.icon || '🏅', lowerWins: Boolean(s.lowerWins) };
      data.sports.set(s.id, { id: s.id, ...sport });
      ops.push({ type: 'set', col: 'sports', id: s.id, data: sport });
      sportIds.set(s.id, s.id);
    }
  }
  for (const n of backup.players || []) if (typeof n === 'string' && n.trim()) ensurePlayer(gid, n, ops);

  const games = data.games.get(gid) || new Map();
  let added = 0;
  let updated = 0;
  let ignored = 0;
  const now = new Date().toISOString();
  for (const g of backup.games) {
    const valid =
      g &&
      g.id &&
      sportIds.has(g.sport) &&
      Number.isFinite(g.me) &&
      Array.isArray(g.opponents) &&
      g.opponents.length > 0 &&
      g.opponents.every((o) => o && typeof o.name === 'string' && o.name.trim() && Number.isFinite(o.score));
    const existing = valid ? games.get(g.id) : null;
    if (!valid || (existing && !canEdit({ ...existing, group: gid }))) {
      ignored += 1;
      continue;
    }
    const players = [{ pid: myPid(gid), score: g.me }, ...g.opponents.map((o) => ({ pid: ensurePlayer(gid, o.name, ops), score: o.score }))];
    const game = {
      date: g.date,
      sport: sportIds.get(g.sport),
      location: g.location || '',
      comments: g.comments || '',
      players,
      pids: players.map((p) => p.pid),
      createdBy: existing?.createdBy || session.uid,
      createdByName: existing?.createdByName || getMe(gid),
      createdAt: g.createdAt || now,
      updatedAt: g.updatedAt || now,
    };
    ops.push({ type: 'set', col: gamesPath(gid), id: g.id, data: game });
    if (existing) updated += 1;
    else added += 1;
  }
  await commitInChunks(ops);
  return { added, updated, ignored };
}

// ---------------------------------------------------------------------------
// Propre a ce telephone : brouillon de saisie, joueurs du jour, dernier groupe utilise
// ---------------------------------------------------------------------------

export function getDraft() {
  return read(LOCAL.draft, null);
}

export function setDraft(draft) {
  writeLocal(LOCAL.draft, draft);
}

export function getDayPlayers(date) {
  const day = read(LOCAL.day, null);
  return day && day.date === date ? day.players : [];
}

export function addDayPlayer(date, name) {
  const players = getDayPlayers(date);
  if (name && !players.includes(name)) writeLocal(LOCAL.day, { date, players: [...players, name] });
}

export const getPref = (key, fallback = null) => read(`sl.pref.${key}`, fallback);
export const setPref = (key, value) => writeLocal(`sl.pref.${key}`, value);

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // non supporte
  }
}
