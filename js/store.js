// Donnees partagees par le groupe (Firestore) + quelques reglages propres au telephone (localStorage).
//
// Collections Firestore :
//   sports/{id}  : { name, icon, lowerWins }
//   players/{id} : { name, uid, mergedInto, createdBy }
//                  uid = compte Google relie a ce joueur (ou null) ; mergedInto = joueur fusionne dans un autre
//   games/{id}   : { date, sport, location, comments, players: [{ pid, score }], pids, createdBy, createdByName, createdAt, updatedAt }
//   members/{uid}: { code, pid, email, name, joinedAt, revoked } ; un membre du groupe et le joueur qui le represente
//   invites/{e-mail} : { pid } ; joueur attribue par un administrateur a un e-mail (entree sans code)
//   config/group : { code, admins: [e-mails] } ; cree dans la console Firebase
// Un joueur peut porter un champ email : seul ce compte pourra le revendiquer.
//
// Les ecrans travaillent sur des parties "vues par un joueur" : { ...partie, me: score, opponents: [{ name, score }] }.
import * as cloud from './cloud.js';

const LOCAL = { draft: 'sl.draft', day: 'sl.day', migrated: 'sl.migrated' };
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

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

const data = { sports: new Map(), players: new Map(), games: new Map() };
// Lus seulement par les administrateurs
const admin = { members: new Map(), invites: new Map(), stops: null };
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

export const account = () => ({ email: session.user?.email || '', name: session.user?.displayName || '', code: config?.code || '' });

export const isAdmin = () => Boolean(myEmail()) && (config?.admins || []).some((e) => String(e).toLowerCase() === myEmail());

export const watchMember = (userId, callback, onError) => cloud.watchDoc('members', userId, callback, onError);

// Avant d'etre membre : invitation a mon e-mail, ou administrateur ? (on peut alors entrer sans code)
export async function canJoinWithoutCode() {
  const [invite, cfg] = await Promise.all([cloud.getDoc('invites', myEmail()), cloud.getDoc('config', 'group')]);
  if (cfg) config = cfg;
  return Boolean(invite) || isAdmin();
}

function startAdminSync() {
  if (admin.stops) return;
  admin.stops = ['members', 'invites'].map((col) =>
    cloud.watchCollection(
      col,
      (docs) => {
        admin[col] = new Map(docs.map((d) => [d.id, d]));
        handlers.change();
      },
      (e) => handlers.error(e),
    ),
  );
}

function stopAdminSync() {
  admin.stops?.forEach((stop) => stop());
  admin.stops = null;
  admin.members = new Map();
  admin.invites = new Map();
}

// Ecoute les trois collections ; onReady est appele une fois que toutes ont repondu
export function startSync(onReady) {
  const pending = new Set(Object.keys(data));
  const stopConfig = cloud.watchDoc(
    'config',
    'group',
    (doc) => {
      config = doc;
      if (isAdmin()) startAdminSync();
      else stopAdminSync();
      if (!pending.size) handlers.change();
    },
    () => {},
  );
  const stops = Object.keys(data).map((col) =>
    cloud.watchCollection(
      col,
      (docs) => {
        data[col] = new Map(docs.map((d) => [d.id, d]));
        if (pending.size) {
          pending.delete(col);
          if (!pending.size) onReady();
        } else handlers.change();
      },
      (e) => handlers.error(e),
    ),
  );
  return () => {
    stops.forEach((stop) => stop());
    stopConfig();
    stopAdminSync();
    config = null;
    for (const col of Object.keys(data)) data[col] = new Map();
  };
}

// Applique les modifications tout de suite en local, puis les envoie.
// Si le serveur refuse, Firestore annule et l'ecran se remet a jour tout seul.
function commit(ops) {
  for (const op of ops) {
    const map = { ...data, members: admin.members, invites: admin.invites }[op.col];
    if (!map) continue;
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
// Joueurs
// ---------------------------------------------------------------------------

// Suit les fusions jusqu'au joueur final
function resolve(pid) {
  let id = pid;
  for (let i = 0; i < 20; i += 1) {
    const next = data.players.get(id)?.mergedInto;
    if (!next) break;
    id = next;
  }
  return id;
}

const nameOf = (pid) => data.players.get(resolve(pid))?.name || '?';
const activePlayers = () => [...data.players.values()].filter((p) => !p.mergedInto && typeof p.name === 'string');
const findPlayer = (name) => {
  const n = normalize(name);
  return activePlayers().find((p) => normalize(p.name) === n) || null;
};

export const myPid = () => session.member?.pid || null;
export const getMe = () => (myPid() ? nameOf(myPid()) : '');
export const pidOf = (name) => findPlayer(name)?.id || null;

export function getPlayers() {
  return activePlayers()
    .map((p) => p.name)
    .sort(byName);
}

// Pour les reglages : { pid, name, linked, mine, email }
export function getPlayerDetails() {
  return activePlayers()
    .map((p) => ({ pid: p.id, name: p.name, linked: Boolean(p.uid), mine: p.id === myPid(), email: p.email || '' }))
    .sort((a, b) => byName(a.name, b.name));
}

// Joueurs que je peux revendiquer : pas encore relies a un compte, ni attribues a un autre e-mail
export const unclaimedPlayers = () => getPlayerDetails().filter((p) => !p.linked && (!p.email || p.email === myEmail()));

// Joueur qu'un administrateur m'a attribue (par mon e-mail)
export const assignedPlayer = () => getPlayerDetails().find((p) => !p.linked && p.email && p.email === myEmail()) || null;

// Trouve le joueur par son nom, ou le cree (operation ajoutee a ops)
function ensurePlayer(name, ops) {
  const clean = name.trim();
  const found = findPlayer(clean);
  if (found) return found.id;
  const id = uid();
  const player = { name: clean, uid: null, mergedInto: null, createdBy: session.uid };
  data.players.set(id, { id, ...player });
  ops.push({ type: 'set', col: 'players', id, data: player });
  return id;
}

export function addPlayer(name) {
  if (!name.trim()) return;
  const ops = [];
  ensurePlayer(name, ops);
  if (ops.length) commit(ops);
}

// Renomme le joueur. Si le nouveau nom existe deja, les deux joueurs sont fusionnes.
export function renamePlayer(from, to) {
  const clean = to.trim();
  const player = findPlayer(from);
  if (!clean || !player || clean === player.name) return;
  const target = findPlayer(clean);
  if (target && target.id !== player.id) {
    if (player.uid) throw new Error(`« ${player.name} » est relié à un compte : renomme plutôt « ${target.name} » en « ${player.name} ».`);
    commit([{ type: 'update', col: 'players', id: player.id, data: { mergedInto: target.id } }]);
    return;
  }
  if (player.uid && player.uid !== session.uid && !isAdmin()) throw new Error(`« ${player.name} » est relié au compte d'un autre membre : lui seul peut changer son nom.`);
  commit([{ type: 'update', col: 'players', id: player.id, data: { name: clean } }]);
}

// Impossible s'il apparait dans une partie ou s'il est relie a un compte (verifie par l'interface)
export function removePlayer(name) {
  const player = findPlayer(name);
  if (player && !player.uid) commit([{ type: 'delete', col: 'players', id: player.id }]);
}

// ---------------------------------------------------------------------------
// Administration (refuse par le serveur pour les autres membres)
// ---------------------------------------------------------------------------

// Membres : { uid, name, email, pid, playerName, revoked, me }
export function getMembers() {
  return [...admin.members.values()]
    .map((m) => ({ uid: m.id, name: m.name || '', email: m.email || '', pid: m.pid || null, playerName: m.pid ? nameOf(m.pid) : '', revoked: Boolean(m.revoked), me: m.id === session.uid }))
    .sort((a, b) => byName(a.playerName || a.email, b.playerName || b.email));
}

// Invitations : { email, pid, playerName, joined }
export function getInvites() {
  const joined = new Set([...admin.members.values()].map((m) => (m.email || '').toLowerCase()));
  return [...admin.invites.values()]
    .map((i) => ({ email: i.id, pid: i.pid, playerName: i.pid ? nameOf(i.pid) : '?', joined: joined.has(i.id) }))
    .sort((a, b) => byName(a.email, b.email));
}

export function setGroupCode(code) {
  if (!code.trim()) throw new Error('Le code ne peut pas être vide.');
  commit([{ type: 'update', col: 'config', id: 'group', data: { code: code.trim() } }]);
}

export function setRevoked(memberUid, revoked) {
  if (memberUid === session.uid) throw new Error('Tu ne peux pas te révoquer toi-même.');
  commit([{ type: 'update', col: 'members', id: memberUid, data: { revoked } }]);
}

// Relie un membre a un joueur (existant ou cree avec ce nom) ; son ancien joueur redevient libre
export function linkMember(memberUid, playerName) {
  const m = admin.members.get(memberUid);
  if (!m) return;
  const existing = findPlayer(playerName);
  if (existing?.uid && existing.uid !== memberUid) throw new Error(`« ${existing.name} » est déjà relié à un autre membre.`);
  const ops = [];
  const pid = ensurePlayer(playerName, ops);
  if (m.pid && m.pid !== pid) ops.push({ type: 'update', col: 'players', id: m.pid, data: { uid: null } });
  ops.push({ type: 'update', col: 'players', id: pid, data: { uid: memberUid, email: (m.email || '').toLowerCase() || null } });
  ops.push({ type: 'update', col: 'members', id: memberUid, data: { pid } });
  commit(ops);
}

// Attribue un joueur (existant ou cree avec ce nom) a un e-mail : la personne entrera sans code avec ce joueur
export function inviteEmail(email, playerName) {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(clean)) throw new Error('Adresse e-mail invalide.');
  if (!playerName.trim()) throw new Error('Choisis un nom de joueur.');
  const existing = findPlayer(playerName);
  if (existing?.uid) throw new Error(`« ${existing.name} » est déjà relié à un compte.`);
  const ops = [];
  const pid = ensurePlayer(playerName, ops);
  const previous = admin.invites.get(clean);
  if (previous?.pid && previous.pid !== pid) ops.push({ type: 'update', col: 'players', id: previous.pid, data: { email: null } });
  ops.push({ type: 'update', col: 'players', id: pid, data: { email: clean } });
  ops.push({ type: 'set', col: 'invites', id: clean, data: { pid } });
  commit(ops);
}

export function removeInvite(email) {
  const invite = admin.invites.get(email);
  const ops = [{ type: 'delete', col: 'invites', id: email }];
  const player = invite?.pid && data.players.get(invite.pid);
  if (player && !player.uid && player.email === email) ops.push({ type: 'update', col: 'players', id: player.id, data: { email: null } });
  commit(ops);
}

// --- Rejoindre le groupe et choisir son joueur (attend le serveur) ---

export function joinGroup(code) {
  const u = session.user;
  return cloud.write([
    {
      type: 'set',
      col: 'members',
      id: u.uid,
      data: { code: code.trim(), pid: null, email: u.email || '', name: u.displayName || '', joinedAt: new Date().toISOString() },
    },
  ]);
}

export function claimPlayer(pid) {
  return commit([
    { type: 'update', col: 'players', id: pid, data: { uid: session.uid } },
    { type: 'update', col: 'members', id: session.uid, data: { pid } },
  ]);
}

export function createMyPlayer(name) {
  const clean = name.trim();
  if (!clean) return Promise.reject(new Error('Donne ton nom de joueur.'));
  if (findPlayer(clean)) return Promise.reject(new Error(`« ${clean} » existe déjà : choisis-le dans la liste.`));
  const id = uid();
  return commit([
    { type: 'set', col: 'players', id, data: { name: clean, uid: session.uid, mergedInto: null, createdBy: session.uid } },
    { type: 'update', col: 'members', id: session.uid, data: { pid: id } },
  ]);
}

// ---------------------------------------------------------------------------
// Sports et jeux : { id, name, icon, lowerWins }
// ---------------------------------------------------------------------------

export function getSports() {
  return [...data.sports.values()].filter((s) => typeof s.name === 'string').sort((a, b) => byName(a.name, b.name));
}

export function saveSport(sport) {
  const saved = { id: sport.id || uid(), name: sport.name.trim(), icon: (sport.icon || '').trim() || '🏅', lowerWins: Boolean(sport.lowerWins) };
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

// Partie avec les noms des joueurs (fusions resolues)
function view(g) {
  return {
    ...g,
    players: (g.players || []).map((p) => ({ pid: resolve(p.pid), name: nameOf(p.pid), score: p.score })),
  };
}

// Partie vue par un joueur, ou null s'il n'y a pas participe
export function perspective(g, pid) {
  const me = g.players.find((p) => p.pid === pid);
  if (!me) return null;
  return { ...g, me: me.score, opponents: g.players.filter((p) => p !== me).map(({ name, score }) => ({ name, score })) };
}

// Toutes les parties du groupe
export function getAllGames() {
  return [...data.games.values()].filter((g) => Array.isArray(g.players)).map(view);
}

// Parties d'un joueur (moi par defaut), de son point de vue
export function getGames(pid = myPid()) {
  if (!pid) return [];
  return getAllGames()
    .map((g) => perspective(g, pid))
    .filter(Boolean);
}

// Meme regle que firestore.rules : l'auteur, les joueurs de la partie et les administrateurs
export function canEdit(g) {
  return isAdmin() || g.createdBy === session.uid || (g.pids || []).includes(myPid());
}

// record : { id, createdAt, date, location, sport, me, opponents: [{ name, score }], comments, owner }
// owner : joueur dont "me" est le score (moi par defaut ; un administrateur peut modifier la partie d'un autre)
export function saveGame(record) {
  const ops = [];
  const ownerPid = record.owner ? ensurePlayer(record.owner, ops) : myPid();
  const players = [
    { pid: ownerPid, score: record.me },
    ...record.opponents.map((o) => ({ pid: ensurePlayer(o.name, ops), score: o.score })),
  ];
  const previous = record.id ? data.games.get(record.id) : null;
  const now = new Date().toISOString();
  const id = record.id || uid();
  const game = {
    date: record.date,
    sport: record.sport,
    location: record.location || '',
    comments: record.comments || '',
    players,
    pids: players.map((p) => p.pid),
    createdBy: previous?.createdBy || session.uid,
    createdByName: previous?.createdByName || getMe(),
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
  ops.push({ type: 'set', col: 'games', id, data: game });
  commit(ops);
  return { id, ...game };
}

export function deleteGame(id) {
  commit([{ type: 'delete', col: 'games', id }]);
}

// ---------------------------------------------------------------------------
// Sauvegarde et import des anciennes donnees (format "telephone", version 1)
// ---------------------------------------------------------------------------

export function exportBackup() {
  const strip = (map) => [...map.values()];
  return { app: 'score-logger', version: 2, exportedAt: new Date().toISOString(), sports: strip(data.sports), players: strip(data.players), games: strip(data.games) };
}

// Parties encore stockees sur ce telephone et pas encore envoyees au groupe
export function legacyBackup() {
  if (read(LOCAL.migrated, false)) return null;
  const games = read(LEGACY.games, []);
  if (!Array.isArray(games) || !games.length) return null;
  return { me: read(LEGACY.me, ''), sports: read(LEGACY.sports, []), players: read(LEGACY.players, []), games };
}

export const legacyName = () => read(LEGACY.me, '');
export const markMigrated = () => writeLocal(LOCAL.migrated, true);

// Envoie au groupe des parties au format version 1 (fichier JSON ou anciennes donnees du telephone).
// Dans ces parties, "me" est le joueur connecte. Les sports et joueurs sont rapproches par leur nom.
export async function importLegacy(backup) {
  if (backup?.version === 2) throw new Error('Ce fichier est une sauvegarde du groupe entier : il sert d’archive et ne se réimporte pas.');
  if (!backup || !Array.isArray(backup.games)) throw new Error('Fichier invalide : liste "games" absente');
  if (!myPid()) throw new Error('Choisis d’abord ton joueur.');
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
  for (const n of backup.players || []) if (typeof n === 'string' && n.trim()) ensurePlayer(n, ops);

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
    const existing = valid ? data.games.get(g.id) : null;
    if (!valid || (existing && !canEdit(existing))) {
      ignored += 1;
      continue;
    }
    const players = [{ pid: myPid(), score: g.me }, ...g.opponents.map((o) => ({ pid: ensurePlayer(o.name, ops), score: o.score }))];
    const game = {
      date: g.date,
      sport: sportIds.get(g.sport),
      location: g.location || '',
      comments: g.comments || '',
      players,
      pids: players.map((p) => p.pid),
      createdBy: existing?.createdBy || session.uid,
      createdByName: existing?.createdByName || getMe(),
      createdAt: g.createdAt || now,
      updatedAt: g.updatedAt || now,
    };
    ops.push({ type: 'set', col: 'games', id: g.id, data: game });
    if (existing) updated += 1;
    else added += 1;
  }
  await commitInChunks(ops);
  return { added, updated, ignored };
}

// ---------------------------------------------------------------------------
// Propre a ce telephone : brouillon de saisie et joueurs du jour
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

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // non supporte
  }
}
