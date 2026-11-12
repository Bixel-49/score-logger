// Calculs de statistiques.
// Une partie, vue par un joueur :
//   { id, date: 'AAAA-MM-JJ', sport: id, title, mode, me: score, opponents: [{ name, score, team }], teammates: [nom],
//     result, location, comments, createdAt }
//   mode : absent (chacun pour soi), 'teams' (par equipes) ou 'coop' (cooperatif)
//   - chacun pour soi : me = mon score, opponents = les autres joueurs
//   - equipes : me = score de mon equipe, teammates = mes coequipiers, opponents = joueurs adverses avec le score
//     et le numero de leur equipe
//   - cooperatif : teammates = les autres joueurs, opponents = [], result = 'W' ou 'L', me = score commun (facultatif)
//   title : nom du jeu (jeux de societe), facultatif ; pour un sport "record" : nom du record
//   record : { name, best, holderName, win, attempt } pour un record (voir store.js) ; win = je detiens le record
// Un sport   : { id, name, icon, lowerWins, titled } ; lowerWins = le plus petit score gagne ; titled = demander le nom du jeu
// Resultats : 'W' victoire, 'D' nul, 'L' defaite.

export const MODES = { ffa: 'Chacun pour soi', teams: 'Équipes', coop: 'Coopératif' };
export const modeOf = (game) => (game.mode === 'teams' || game.mode === 'coop' ? game.mode : 'ffa');

// > 0 si le score a est meilleur que le score b
const compare = (a, b, lowerWins) => (lowerWins ? b - a : a - b);
const sign = (d) => (d > 0 ? 'W' : d < 0 ? 'L' : 'D');

// Scores des equipes adverses : Map numero -> score
function otherTeams(game) {
  const teams = new Map();
  for (const o of game.opponents) if (!teams.has(o.team)) teams.set(o.team, o.score);
  return teams;
}

// Victoire = seul en tete ; nul = a egalite en tete ; defaite sinon.
// rank / size : ma place et le nombre de participants (equipes en mode equipes ; null en cooperatif)
// duels : resultat face a chaque adversaire. A plusieurs, seul le vainqueur bat les autres :
//   un duel ne compte que si l'un des deux a gagne la partie (finir 2e ne bat pas le 3e)
// partners : resultat partage avec chaque coequipier
// Duels contre les adversaires (ou joueurs adverses) : scores = [{ name, score }]
function duelsOf(me, scores, lowerWins) {
  const best = [me, ...scores.map((o) => o.score)].reduce((a, b) => (compare(a, b, lowerWins) >= 0 ? a : b));
  const top = (s) => compare(s, best, lowerWins) === 0;
  return scores
    .filter((o) => top(me) || top(o.score))
    .map((o) => ({ name: o.name, result: sign(compare(me, o.score, lowerWins)) }));
}

export function outcome(game, sport) {
  // Record : une seule victoire, celle du detenteur ; les autres participants perdent contre lui
  if (game.record) {
    const win = Boolean(game.record.win);
    return {
      result: win ? 'W' : 'L',
      rank: null,
      size: game.opponents.length + 1,
      duels: win ? game.opponents.map((o) => ({ name: o.name, result: 'W' })) : game.opponents.filter((o) => o.name === game.record.holderName).map((o) => ({ name: o.name, result: 'L' })),
      partners: [],
    };
  }
  const lowerWins = Boolean(sport?.lowerWins);
  const mode = modeOf(game);
  const teammates = game.teammates || [];
  if (mode === 'coop') {
    const result = game.result === 'W' ? 'W' : 'L';
    return { result, rank: null, size: teammates.length + 1, duels: [], partners: teammates.map((name) => ({ name, result })) };
  }
  if (mode === 'teams') {
    const diffs = [...otherTeams(game).values()].map((s) => compare(game.me, s, lowerWins));
    const rank = 1 + diffs.filter((d) => d < 0).length;
    const result = rank > 1 ? 'L' : diffs.some((d) => d === 0) ? 'D' : 'W';
    return {
      result,
      rank,
      size: diffs.length + 1,
      duels: duelsOf(game.me, game.opponents, lowerWins),
      partners: teammates.map((name) => ({ name, result })),
    };
  }
  const diffs = game.opponents.map((o) => compare(game.me, o.score, lowerWins));
  const rank = 1 + diffs.filter((d) => d < 0).length;
  const result = rank > 1 ? 'L' : diffs.some((d) => d === 0) ? 'D' : 'W';
  return {
    result,
    rank,
    size: game.opponents.length + 1,
    duels: duelsOf(game.me, game.opponents, lowerWins),
    partners: [],
  };
}

export const formatNumber = (n) => (Number.isInteger(n) ? String(n) : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

export function scoreText(game) {
  const mode = modeOf(game);
  if (mode === 'coop') return `${game.result === 'W' ? 'Gagné' : 'Perdu'}${Number.isFinite(game.me) ? ` · ${formatNumber(game.me)}` : ''}`;
  if (mode === 'teams') return [game.me, ...otherTeams(game).values()].map(formatNumber).join('-');
  if (game.opponents.length === 1) return `${formatNumber(game.me)}-${formatNumber(game.opponents[0].score)}`;
  return [game.me, ...game.opponents.map((o) => o.score)].map(formatNumber).join(' · ');
}

// "vs Paul, Marie" ; en equipes "avec Luc · vs Paul, Marie" ; en cooperatif "avec Luc, Marie"
export function versusText(game) {
  const mode = modeOf(game);
  const mates = game.teammates || [];
  if (mode === 'coop') return mates.length ? `avec ${mates.join(', ')}` : 'en solo';
  if (!game.opponents.length && !mates.length) return 'en solo';
  const vs = `vs ${game.opponents.map((o) => o.name).join(', ')}`;
  return mates.length ? `avec ${mates.join(', ')} · ${vs}` : vs;
}

export const placeText = (rank, size) => `${rank}${rank === 1 ? 'er' : 'e'}/${size}`;

// Ordre chronologique : date, puis ordre de saisie pour les parties du meme jour
export function chronological(games) {
  return [...games].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export const winRate = (t) => (t.played ? t.wins / t.played : 0);
export const percent = (t) => `${Math.round(winRate(t) * 100)} %`;

function emptyTally(key, name = key) {
  return { key, name, played: 0, wins: 0, draws: 0, losses: 0 };
}

function addTo(tally, result) {
  tally.played += 1;
  if (result === 'W') tally.wins += 1;
  else if (result === 'D') tally.draws += 1;
  else tally.losses += 1;
}

const byRate = (a, b) => winRate(b) - winRate(a) || b.played - a.played || a.name.localeCompare(b.name, 'fr');

// sports : Map id -> sport
export function summary(games, sports) {
  const total = emptyTally('');
  let streak = { result: null, length: 0 };
  let bestStreak = 0;
  let rankSum = 0;
  let multi = 0;
  const form = [];
  for (const g of chronological(games)) {
    const o = outcome(g, sports.get(g.sport));
    addTo(total, o.result);
    streak = streak.result === o.result ? { result: o.result, length: streak.length + 1 } : { result: o.result, length: 1 };
    if (o.result === 'W') bestStreak = Math.max(bestStreak, streak.length);
    if (o.rank != null && o.size > 2) {
      multi += 1;
      rankSum += o.rank;
    }
    form.push(o.result);
  }
  return { ...total, streak, bestStreak, form: form.slice(-10), multi, avgRank: multi ? rankSum / multi : null };
}

// Face-a-face avec chaque adversaire (a plusieurs, seuls les duels avec le vainqueur comptent)
export function byOpponent(games, sports) {
  const map = new Map();
  for (const g of games) {
    for (const d of outcome(g, sports.get(g.sport)).duels) {
      if (!map.has(d.name)) map.set(d.name, emptyTally(d.name));
      addTo(map.get(d.name), d.result);
    }
  }
  return [...map.values()].sort(byRate);
}

// Bilan avec chaque partenaire (coequipier ou partenaire de jeu cooperatif)
export function byPartner(games, sports) {
  const map = new Map();
  for (const g of games) {
    for (const p of outcome(g, sports.get(g.sport)).partners) {
      if (!map.has(p.name)) map.set(p.name, emptyTally(p.name));
      addTo(map.get(p.name), p.result);
    }
  }
  return [...map.values()].sort(byRate);
}

export function bySport(games, sports) {
  const map = new Map();
  for (const g of games) {
    const sport = sports.get(g.sport);
    if (!map.has(g.sport)) map.set(g.sport, { ...emptyTally(g.sport, sport?.name || '?'), icon: sport?.icon || '🏅' });
    addTo(map.get(g.sport), outcome(g, sport).result);
  }
  return [...map.values()].sort((a, b) => b.played - a.played || byRate(a, b));
}

// Par nom de jeu (jeux de societe) ; les parties sans nom sont regroupees sous "Sans nom"
export function byTitle(games, sports) {
  const map = new Map();
  for (const g of games) {
    const name = (g.title || '').trim() || 'Sans nom';
    if (!map.has(name)) map.set(name, emptyTally(name));
    addTo(map.get(name), outcome(g, sports.get(g.sport)).result);
  }
  return [...map.values()].sort((a, b) => b.played - a.played || byRate(a, b));
}

// Par mode de jeu (chacun pour soi, equipes, cooperatif)
export function byMode(games, sports) {
  const map = new Map();
  for (const g of games) {
    const mode = modeOf(g);
    if (!map.has(mode)) map.set(mode, emptyTally(mode, MODES[mode]));
    addTo(map.get(mode), outcome(g, sports.get(g.sport)).result);
  }
  return [...map.values()].sort((a, b) => b.played - a.played);
}

// Selon le nombre de joueurs autour de la table (utile pour les jeux de societe) ; sans le cooperatif
export function byTableSize(games, sports) {
  const map = new Map();
  for (const g of games) {
    if (modeOf(g) !== 'ffa') continue;
    const o = outcome(g, sports.get(g.sport));
    if (!map.has(o.size)) map.set(o.size, { ...emptyTally(o.size, `${o.size} joueurs`), rankSum: 0 });
    const t = map.get(o.size);
    addTo(t, o.result);
    t.rankSum += o.rank;
  }
  return [...map.values()].sort((a, b) => a.key - b.key).map((t) => ({ ...t, avgRank: t.rankSum / t.played }));
}

// Meilleur / pire selon le % de victoires, a partir de minPlayed
function extremes(tallies, minPlayed) {
  const eligible = tallies.filter((t) => t.played >= minPlayed).sort(byRate);
  if (!eligible.length) return { best: null, worst: null };
  const worst = [...eligible].sort((a, b) => winRate(a) - winRate(b) || b.played - a.played)[0];
  return { best: eligible[0], worst: eligible.length > 1 ? worst : null };
}

const mostPlayed = (tallies) => [...tallies].sort((a, b) => b.played - a.played)[0] || null;

export function highlights(games, sports) {
  const opponents = byOpponent(games, sports);
  const perSport = bySport(games, sports);
  const partners = byPartner(games, sports);
  const opp = extremes(opponents, 2);
  const sp = extremes(perSport, 3);
  const pa = extremes(partners, 2);
  return {
    favouriteVictim: opp.best,
    nemesis: opp.worst,
    mostFaced: mostPlayed(opponents),
    bestPartner: pa.best,
    mostPlayedSport: perSport.length > 1 ? mostPlayed(perSport) : null,
    bestSport: perSport.length > 1 ? sp.best : null,
  };
}

// Scores d'un seul sport : moyenne et record (parties avec un score seulement)
export function scoreStats(games, sport) {
  const scored = games.filter((g) => Number.isFinite(g.me));
  if (!scored.length) return null;
  const record = scored.reduce((best, g) => (compare(g.me, best.me, sport?.lowerWins) > 0 ? g : best));
  return { average: scored.reduce((a, g) => a + g.me, 0) / scored.length, record };
}

// Fiche d'un adversaire : bilan global, par sport, et parties
export function opponentProfile(games, sports, name) {
  const together = games.filter((g) => g.opponents.some((o) => o.name === name));
  const total = emptyTally(name);
  const map = new Map();
  for (const g of together) {
    const sport = sports.get(g.sport);
    const duel = outcome(g, sport).duels.find((d) => d.name === name);
    // Ni lui ni moi n'avons gagne : la partie est listee mais ne compte pas dans le bilan
    if (!duel) continue;
    addTo(total, duel.result);
    if (!map.has(g.sport)) map.set(g.sport, { ...emptyTally(g.sport, sport?.name || '?'), icon: sport?.icon || '🏅' });
    addTo(map.get(g.sport), duel.result);
  }
  return { total, perSport: [...map.values()].sort((a, b) => b.played - a.played), games: chronological(together).reverse() };
}

// Fiche d'un partenaire : bilan des parties jouees ensemble dans le meme camp
export function partnerProfile(games, sports, name) {
  const together = games.filter((g) => (g.teammates || []).includes(name));
  const total = emptyTally(name);
  for (const g of together) addTo(total, outcome(g, sports.get(g.sport)).result);
  return { total, games: chronological(together).reverse() };
}

// Regroupe par jour, du plus recent au plus ancien
export function byDay(games, sports) {
  const days = new Map();
  for (const g of chronological(games).reverse()) {
    if (!days.has(g.date)) days.set(g.date, []);
    days.get(g.date).push(g);
  }
  return [...days.entries()].map(([date, list]) => {
    const t = emptyTally(date);
    for (const g of list) addTo(t, outcome(g, sports.get(g.sport)).result);
    return { date, games: list, ...t };
  });
}

// Problemes bloquants avant l'enregistrement (partie au format "vue par un joueur")
// sport : pour un record, le nom du record est obligatoire et les autres participants facultatifs
export function validate(game, sport = null) {
  const errors = [];
  const mode = modeOf(game);
  if (!game.sport) errors.push('Choisis le sport ou le jeu.');
  if (sport?.record && !(game.title || '').trim()) errors.push('Indique de quel record il s’agit.');
  const others = [...(game.teammates || []), ...game.opponents.map((o) => o.name)].map((n) => n.trim());
  if (others.some((n) => !n)) errors.push('Un joueur n’a pas de nom.');
  if (new Set(others.filter(Boolean)).size !== others.filter(Boolean).length) errors.push('Un même joueur apparaît deux fois.');
  if (mode === 'coop') {
    if (game.result !== 'W' && game.result !== 'L') errors.push('Indique si la partie est gagnée ou perdue.');
    return errors;
  }
  if (!Number.isFinite(game.me)) errors.push(mode === 'teams' ? 'Saisis le score de ton équipe.' : 'Saisis ton score.');
  if (!game.opponents.length && !sport?.record) errors.push(mode === 'teams' ? 'Ajoute au moins un joueur dans l’équipe adverse.' : 'Ajoute au moins un adversaire.');
  if (mode === 'teams') {
    const teams = new Map();
    for (const o of game.opponents) teams.set(o.team, o.score);
    for (const [team, score] of teams) if (!Number.isFinite(score)) errors.push(`Équipe ${team + 1} : score manquant.`);
  } else {
    game.opponents.forEach((o) => {
      if (o.name.trim() && !Number.isFinite(o.score)) errors.push(`${o.name} : score manquant.`);
    });
  }
  return errors;
}
