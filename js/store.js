// Stockage local sur le telephone (localStorage). Rien n'est envoye sur internet.

const KEYS = {
  me: 'sl.me',
  sports: 'sl.sports',
  players: 'sl.players',
  games: 'sl.games',
  draft: 'sl.draft',
  day: 'sl.day',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// Laisse remonter l'erreur (stockage plein) pour que l'interface la signale
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const byName = (a, b) => a.localeCompare(b, 'fr');

// --- Mon prenom (affichage seulement) ---

export function getMe() {
  return read(KEYS.me, '');
}

export function setMe(name) {
  write(KEYS.me, name.trim());
}

// --- Sports et jeux : { id, name, icon, lowerWins } ---

export function getSports() {
  return read(KEYS.sports, []);
}

export function saveSport(sport) {
  const sports = getSports();
  const saved = { ...sport, id: sport.id || uid(), name: sport.name.trim(), icon: (sport.icon || '').trim() || '🏅' };
  const index = sports.findIndex((s) => s.id === saved.id);
  if (index >= 0) sports[index] = saved;
  else sports.push(saved);
  write(KEYS.sports, sports.sort((a, b) => byName(a.name, b.name)));
  return saved;
}

// Impossible si des parties utilisent ce sport (verifie par l'interface)
export function deleteSport(id) {
  write(KEYS.sports, getSports().filter((s) => s.id !== id));
}

// --- Joueurs : liste enregistree + tous les noms presents dans les parties ---

export function getPlayers() {
  const names = new Set(read(KEYS.players, []));
  for (const g of getGames()) for (const o of g.opponents) names.add(o.name);
  return [...names].sort(byName);
}

export function addPlayer(name) {
  const clean = name.trim();
  if (!clean) return;
  const players = read(KEYS.players, []);
  if (!players.includes(clean)) write(KEYS.players, [...players, clean].sort(byName));
}

// Renomme partout (liste et parties). Si le nouveau nom existe deja, les deux joueurs sont fusionnes.
export function renamePlayer(from, to) {
  const clean = to.trim();
  if (!clean || clean === from) return;
  write(KEYS.players, [...new Set(read(KEYS.players, []).map((n) => (n === from ? clean : n)))].sort(byName));
  write(
    KEYS.games,
    getGames().map((g) => ({ ...g, opponents: g.opponents.map((o) => (o.name === from ? { ...o, name: clean } : o)) })),
  );
}

// Retire le joueur de la liste ; impossible s'il apparait dans une partie
export function removePlayer(name) {
  write(KEYS.players, read(KEYS.players, []).filter((n) => n !== name));
}

// Joueurs presents sur une journee, ajoutes avant meme d'avoir joue une partie ensemble
export function getDayPlayers(date) {
  const day = read(KEYS.day, null);
  return day && day.date === date ? day.players : [];
}

export function addDayPlayer(date, name) {
  const players = getDayPlayers(date);
  if (name && !players.includes(name)) write(KEYS.day, { date, players: [...players, name] });
}

// --- Parties ---

export function getGames() {
  return read(KEYS.games, []);
}

export function saveGame(record) {
  const games = getGames();
  const index = games.findIndex((g) => g.id === record.id);
  const now = new Date().toISOString();
  const saved = { ...record, id: record.id || uid(), createdAt: record.createdAt || now, updatedAt: now };
  if (index >= 0) games[index] = saved;
  else games.push(saved);
  write(KEYS.games, games);
  for (const o of saved.opponents) addPlayer(o.name);
  return saved;
}

export function deleteGame(id) {
  write(KEYS.games, getGames().filter((g) => g.id !== id));
}

// --- Sauvegarde / restauration ---

export function exportBackup() {
  return { app: 'score-logger', version: 1, me: getMe(), sports: getSports(), players: read(KEYS.players, []), games: getGames() };
}

// Fusionne : un element deja present (meme id) est remplace par la version importee
export function importBackup(data) {
  if (!data || !Array.isArray(data.games)) throw new Error('Fichier invalide : liste "games" absente');
  const sports = getSports();
  for (const s of data.sports || []) {
    if (!s || !s.id || typeof s.name !== 'string') continue;
    const index = sports.findIndex((x) => x.id === s.id);
    if (index >= 0) sports[index] = s;
    else sports.push(s);
  }
  write(KEYS.sports, sports.sort((a, b) => byName(a.name, b.name)));

  const known = new Set(sports.map((s) => s.id));
  const valid = data.games.filter(
    (g) => g && g.id && known.has(g.sport) && Number.isFinite(g.me) && Array.isArray(g.opponents) && g.opponents.length > 0,
  );
  const games = getGames();
  const index = new Map(games.map((g, i) => [g.id, i]));
  let added = 0;
  for (const g of valid) {
    if (index.has(g.id)) games[index.get(g.id)] = g;
    else {
      games.push(g);
      added += 1;
    }
  }
  write(KEYS.games, games);
  for (const n of data.players || []) if (typeof n === 'string') addPlayer(n);
  if (!getMe() && typeof data.me === 'string') setMe(data.me);
  return { added, updated: valid.length - added, ignored: data.games.length - valid.length };
}

// --- Brouillon de la saisie en cours (survit a la fermeture de l'app) ---

export function getDraft() {
  return read(KEYS.draft, null);
}

export function setDraft(draft) {
  try {
    write(KEYS.draft, draft);
  } catch {
    // brouillon non critique
  }
}

export function clearAll() {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key);
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // non supporte
  }
}
