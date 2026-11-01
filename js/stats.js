// Calculs de statistiques.
// Une partie : { id, date: 'AAAA-MM-JJ', sport: id, me: score, opponents: [{ name, score }], location, comments, createdAt }
// Un sport   : { id, name, icon, lowerWins } ; lowerWins = le plus petit score gagne (golf, certains jeux de cartes)
// Resultats : 'W' victoire, 'D' nul, 'L' defaite.

// > 0 si le score a est meilleur que le score b
const compare = (a, b, lowerWins) => (lowerWins ? b - a : a - b);

// Victoire = seul en tete ; nul = a egalite en tete ; defaite sinon.
// duels : resultat face a chaque adversaire (ai-je fait mieux que lui ?)
export function outcome(game, sport) {
  const lowerWins = Boolean(sport?.lowerWins);
  const diffs = game.opponents.map((o) => compare(game.me, o.score, lowerWins));
  const rank = 1 + diffs.filter((d) => d < 0).length;
  const result = rank > 1 ? 'L' : diffs.some((d) => d === 0) ? 'D' : 'W';
  return {
    result,
    rank,
    size: game.opponents.length + 1,
    duels: game.opponents.map((o, i) => ({ name: o.name, result: diffs[i] > 0 ? 'W' : diffs[i] < 0 ? 'L' : 'D' })),
  };
}

const formatNumber = (n) => (Number.isInteger(n) ? String(n) : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

export function scoreText(game) {
  if (game.opponents.length === 1) return `${formatNumber(game.me)}-${formatNumber(game.opponents[0].score)}`;
  return [game.me, ...game.opponents.map((o) => o.score)].map(formatNumber).join(' · ');
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
    if (o.size > 2) {
      multi += 1;
      rankSum += o.rank;
    }
    form.push(o.result);
  }
  return { ...total, streak, bestStreak, form: form.slice(-10), multi, avgRank: multi ? rankSum / multi : null };
}

// Face-a-face avec chaque adversaire (une partie a 4 compte comme 3 duels)
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

export function bySport(games, sports) {
  const map = new Map();
  for (const g of games) {
    const sport = sports.get(g.sport);
    if (!map.has(g.sport)) map.set(g.sport, { ...emptyTally(g.sport, sport?.name || '?'), icon: sport?.icon || '🏅' });
    addTo(map.get(g.sport), outcome(g, sport).result);
  }
  return [...map.values()].sort((a, b) => b.played - a.played || byRate(a, b));
}

// Selon le nombre de joueurs autour de la table (utile pour les jeux de societe)
export function byTableSize(games, sports) {
  const map = new Map();
  for (const g of games) {
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
  const opp = extremes(opponents, 2);
  const sp = extremes(perSport, 3);
  return {
    favouriteVictim: opp.best,
    nemesis: opp.worst,
    mostFaced: mostPlayed(opponents),
    mostPlayedSport: perSport.length > 1 ? mostPlayed(perSport) : null,
    bestSport: perSport.length > 1 ? sp.best : null,
  };
}

// Scores d'un seul sport : moyenne et record
export function scoreStats(games, sport) {
  if (!games.length) return null;
  const scores = games.map((g) => g.me);
  const record = games.reduce((best, g) => (compare(g.me, best.me, sport?.lowerWins) > 0 ? g : best));
  return { average: scores.reduce((a, b) => a + b, 0) / scores.length, record };
}

// Fiche d'un adversaire : bilan global, par sport, et parties
export function opponentProfile(games, sports, name) {
  const together = games.filter((g) => g.opponents.some((o) => o.name === name));
  const total = emptyTally(name);
  const map = new Map();
  for (const g of together) {
    const sport = sports.get(g.sport);
    const duel = outcome(g, sport).duels.find((d) => d.name === name);
    addTo(total, duel.result);
    if (!map.has(g.sport)) map.set(g.sport, { ...emptyTally(g.sport, sport?.name || '?'), icon: sport?.icon || '🏅' });
    addTo(map.get(g.sport), duel.result);
  }
  return { total, perSport: [...map.values()].sort((a, b) => b.played - a.played), games: chronological(together).reverse() };
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

// Problemes bloquants avant l'enregistrement
export function validate(game) {
  const errors = [];
  if (!game.sport) errors.push('Choisis le sport ou le jeu.');
  if (!Number.isFinite(game.me)) errors.push('Saisis ton score.');
  if (!game.opponents.length) errors.push('Ajoute au moins un adversaire.');
  game.opponents.forEach((o, i) => {
    if (!o.name.trim()) errors.push(`Adversaire ${i + 1} : nom manquant.`);
    else if (!Number.isFinite(o.score)) errors.push(`${o.name} : score manquant.`);
  });
  const names = game.opponents.map((o) => o.name.trim()).filter(Boolean);
  if (new Set(names).size !== names.length) errors.push('Un même adversaire apparaît deux fois.');
  return errors;
}
