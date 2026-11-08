import * as store from './store.js';
import * as cloud from './cloud.js';
import {
  outcome,
  scoreText,
  placeText,
  chronological,
  percent,
  winRate,
  summary,
  byOpponent,
  bySport,
  byTableSize,
  highlights,
  scoreStats,
  opponentProfile,
  byDay,
  validate,
} from './stats.js';

// ---------------------------------------------------------------------------
// Utilitaires DOM
// ---------------------------------------------------------------------------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && !['list', 'form'].includes(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  return el;
}

const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function field(label, control, extraClass = '') {
  return h('label', { class: `field ${extraClass}` }, h('span', { class: 'field-label' }, label), control);
}

function toast(message) {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

// Feuilles modales en bas d'ecran. Le bouton retour d'Android les ferme.
const sheets = [];

window.addEventListener('popstate', () => {
  const top = sheets.pop();
  if (!top) return;
  top.el.remove();
  if (!sheets.length) document.body.classList.remove('no-scroll');
  top.resolve?.();
});

function openSheet(title, build) {
  const entry = { el: null, resolve: null };
  const close = () =>
    new Promise((resolve) => {
      if (!sheets.includes(entry)) return resolve();
      entry.resolve = resolve;
      history.back();
    });
  const { body, actions = [] } = build(close);
  const sheet = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Fermer', onclick: close }, '✕')),
    h('div', { class: 'sheet-body' }, body),
    actions.length ? h('div', { class: 'sheet-actions' }, actions) : null,
  );
  entry.el = h('div', { class: 'sheet-backdrop', onclick: (e) => e.target === entry.el && close() }, sheet);
  document.body.append(entry.el);
  document.body.classList.add('no-scroll');
  sheets.push(entry);
  history.pushState({ sheet: sheets.length }, '');
  return close;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function canShareFile(file) {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

// Boutons "Telecharger" + "Partager" (si le telephone le permet)
function exportButtons(filename, makeBlob) {
  const download = h('button', { class: 'btn', onclick: () => downloadBlob(filename, makeBlob()) }, '⬇️ Télécharger');
  const probe = new File([''], filename, { type: 'text/plain' });
  if (!canShareFile(probe)) return [download];
  const share = h(
    'button',
    {
      class: 'btn',
      onclick: async () => {
        const file = new File([makeBlob()], filename, { type: 'text/plain' });
        try {
          await navigator.share({ files: [file], title: filename });
        } catch (e) {
          if (e.name !== 'AbortError') downloadBlob(filename, makeBlob());
        }
      },
    },
    '📤 Partager',
  );
  return [download, share];
}

function persistOrWarn(action) {
  try {
    action();
    return true;
  } catch (e) {
    alert(e.message);
    return false;
  }
}

// Erreur renvoyee par Firebase lors d'un envoi
function cloudError(e) {
  if (e?.code === 'permission-denied') return 'Action refusée par le serveur : seuls l’auteur d’une partie et ses joueurs peuvent la modifier.';
  if (e?.code === 'unavailable') return 'Serveur injoignable. Réessaie avec du réseau.';
  return e?.message || String(e);
}

// --- Dates (stockees en 'AAAA-MM-JJ', heure locale) ---

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function longDate(iso) {
  const text = parseDate(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const shortDate = (iso) => parseDate(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

// ---------------------------------------------------------------------------
// Etat de l'application
// ---------------------------------------------------------------------------

// Une partie en cours de saisie
function emptyRow(sport = '') {
  return { id: null, createdAt: null, sport, me: null, opponents: [], comments: '' };
}

function lastSportId() {
  const last = chronological(store.getGames()).at(-1);
  return last?.sport || store.getSports()[0]?.id || '';
}

// Saisie d'une journee : plusieurs parties enregistrees d'un coup.
// continueFrom : derniere partie enregistree ; on reste sur la meme journee, le meme lieu et le meme sport
function newEditor(continueFrom = null) {
  const last = chronological(store.getGames()).at(-1);
  const base = continueFrom || (last && last.date === today() ? last : null);
  return {
    date: base ? base.date : today(),
    location: base ? base.location || '' : '',
    rows: [emptyRow(continueFrom?.sport || lastSportId())],
    active: 0,
    editing: false,
    dirty: false,
  };
}

function loadDraft() {
  const draft = store.getDraft();
  return draft && Array.isArray(draft.rows) && draft.rows.length ? draft : newEditor();
}

const state = {
  view: 'game',
  editor: loadDraft(),
  period: 'all',
  sport: '',
  historyQuery: '',
  historySport: '',
  // 'mine' : mes parties ; 'all' : tout le groupe. Dernier choix retenu sur ce telephone ;
  // a defaut, tout le groupe pour un administrateur.
  historyScope: (() => {
    try {
      return localStorage.getItem('sl.historyScope');
    } catch {
      return null;
    }
  })(),
  statsPid: '', // joueur dont on regarde les stats ('' = moi)
};

function touchEditor() {
  state.editor.dirty = true;
  store.setDraft(state.editor);
}

const meLabel = () => store.getMe() || 'Moi';
const sportsMap = () => new Map(store.getSports().map((s) => [s.id, s]));
const sportLabel = (s) => (s ? `${s.icon} ${s.name}` : '❓ Sport supprimé');

// Joueurs tries par nombre d'apparitions (les habitues en premier)
function playersByFrequency() {
  const me = store.getMe();
  const count = new Map(store.getPlayers().filter((n) => n !== me).map((n) => [n, 0]));
  for (const g of store.getGames()) for (const o of g.opponents) count.set(o.name, (count.get(o.name) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).map(([n]) => n);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const VIEWS = {
  game: { label: 'Partie', icon: '🎲', render: renderGameView },
  history: { label: 'Historique', icon: '📅', render: renderHistoryView },
  stats: { label: 'Stats', icon: '📊', render: renderStatsView },
  settings: { label: 'Réglages', icon: '⚙️', render: renderSettingsView },
};

function go(view) {
  state.view = view;
  render();
  window.scrollTo(0, 0);
}

function render() {
  const main = document.getElementById('view');
  main.replaceChildren(VIEWS[state.view].render());
  for (const btn of document.querySelectorAll('.tabbar button')) {
    if (btn.dataset.view === state.view) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
}

function rerenderKeepScroll() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

function buildTabbar() {
  const bar = document.getElementById('tabbar');
  bar.replaceChildren(
    ...Object.entries(VIEWS).map(([key, v]) =>
      h('button', { 'data-view': key, onclick: () => go(key) }, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, v.icon), h('span', {}, v.label)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Sports et jeux
// ---------------------------------------------------------------------------

const PRESETS = [
  { name: 'Squash', icon: '🎾' },
  { name: 'Ping-pong', icon: '🏓' },
  { name: 'Badminton', icon: '🏸' },
  { name: 'Fléchettes', icon: '🎯' },
  { name: 'Échecs', icon: '♟️' },
  { name: 'Belote', icon: '🃏' },
  { name: 'Jeu de société', icon: '🎲' },
  { name: 'Golf', icon: '⛳', lowerWins: true },
];

const ICONS = ['🎾', '🏓', '🏸', '🎯', '⛳', '🎳', '🏀', '⚽', '🏐', '♟️', '🃏', '🎲', '🧩', '🀄', '🎮', '🏅'];

function openSportSheet(sport, onSaved) {
  const draft = { name: '', icon: '🏅', lowerWins: false, ...sport };
  const existing = store.getSports().map((s) => normalize(s.name));
  openSheet(sport ? 'Modifier le sport' : 'Nouveau sport ou jeu', (close) => {
    const save = async (value) => {
      if (!value.name.trim()) {
        alert('Donne un nom au sport ou au jeu.');
        return;
      }
      if (!value.id && existing.includes(normalize(value.name.trim()))) {
        alert('Ce sport existe déjà.');
        return;
      }
      let saved;
      if (!persistOrWarn(() => (saved = store.saveSport(value)))) return;
      await close();
      onSaved?.(saved);
    };
    const iconButtons = ICONS.map((icon) =>
      h(
        'button',
        {
          class: `icon-pick ${icon === draft.icon ? 'selected' : ''}`,
          'aria-label': `Icône ${icon}`,
          onclick: (ev) => {
            draft.icon = icon;
            iconButtons.forEach((b) => b.classList.toggle('selected', b === ev.currentTarget));
          },
        },
        icon,
      ),
    );
    const presets = sport ? [] : PRESETS.filter((p) => !existing.includes(normalize(p.name)));
    return {
      body: [
        presets.length
          ? [
              h('span', { class: 'field-label' }, 'Ajout rapide'),
              h('div', { class: 'pchips' }, presets.map((p) => h('button', { class: 'pchip', onclick: () => save({ ...p }) }, `${p.icon} ${p.name}`))),
              h('span', { class: 'field-label' }, 'Ou crée le tien'),
            ]
          : null,
        field(
          'Nom',
          h('input', {
            class: 'input',
            value: draft.name,
            placeholder: 'Ex. Squash, Tarot, Mölkky…',
            oninput: (ev) => (draft.name = ev.target.value),
          }),
        ),
        h('span', { class: 'field-label' }, 'Icône'),
        h('div', { class: 'icon-grid' }, iconButtons),
        h(
          'label',
          { class: 'field toggle' },
          h('input', { type: 'checkbox', checked: Boolean(draft.lowerWins), onchange: (ev) => (draft.lowerWins = ev.target.checked) }),
          h('span', {}, 'Le plus petit score gagne (golf, certains jeux de cartes…)'),
        ),
      ],
      actions: [h('button', { class: 'btn primary', onclick: () => save(draft) }, 'Enregistrer')],
    };
  });
}

// ---------------------------------------------------------------------------
// Vue "Partie" : saisie des parties d'une journee
// ---------------------------------------------------------------------------

function openPlayerPicker(title, current, taken, onPick) {
  openSheet(title, (close) => {
    let query = '';
    const pick = async (name) => {
      await close();
      onPick(name);
    };
    const list = h('div', { class: 'pick-list' });
    const addBtn = h('button', { class: 'btn primary', hidden: true });
    const fill = () => {
      const q = normalize(query.trim());
      const names = playersByFrequency().filter((n) => !taken.includes(n) && (!q || normalize(n).includes(q)));
      list.replaceChildren(
        ...names.map((n) => h('button', { class: `pick ${n === current ? 'selected' : ''}`, onclick: () => pick(n) }, h('span', {}, n))),
      );
      if (!names.length) list.replaceChildren(h('p', { class: 'muted pad center' }, q ? 'Aucun joueur trouvé.' : 'Aucun joueur pour l’instant : tape un nom.'));
      const exact = playersByFrequency().some((n) => normalize(n) === q);
      addBtn.hidden = !q || exact;
      addBtn.textContent = `➕ Ajouter « ${query.trim()} »`;
    };
    addBtn.addEventListener('click', () => pick(query.trim()));
    const search = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Rechercher ou ajouter un joueur…',
      autocomplete: 'off',
      oninput: (e) => {
        query = e.target.value;
        fill();
      },
      onkeydown: (e) => {
        if (e.key !== 'Enter' || !query.trim()) return;
        const match = playersByFrequency().find((n) => normalize(n) === normalize(query.trim()));
        pick(match || query.trim());
      },
    });
    fill();
    setTimeout(() => search.focus(), 50);
    return {
      body: [search, addBtn, list],
      actions: current ? [h('button', { class: 'btn danger', onclick: () => pick('') }, 'Retirer ce joueur')] : [],
    };
  });
}

const RESULTS = { W: ['ok', 'V', 'Victoire'], D: ['neutral', 'N', 'Nul'], L: ['bad', 'D', 'Défaite'] };

function resultPill(result) {
  const [cls, letter, label] = RESULTS[result];
  return h('span', { class: `result ${cls}`, title: label }, letter);
}

const rowIsEmpty = (row) => row.me == null && !row.opponents.length;
const rowComplete = (row) => Number.isFinite(row.me) && row.opponents.length > 0 && row.opponents.every((o) => Number.isFinite(o.score));

function rowToRecord(e, row) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    date: e.date || today(),
    location: e.location.trim(),
    sport: row.sport,
    me: row.me,
    opponents: row.opponents.map((o) => ({ name: o.name.trim(), score: o.score })),
    comments: row.comments || '',
    owner: row.owner || null,
  };
}

// Pastille V / N / D et place, des que tous les scores sont saisis
function rowStatus(row, sports) {
  if (!rowComplete(row)) return null;
  const o = outcome(row, sports.get(row.sport));
  return [resultPill(o.result), o.size > 2 ? h('span', { class: 'muted small' }, placeText(o.rank, o.size)) : null];
}

// Champ de score : nombres decimaux et negatifs acceptes
function scoreInput(target, key, label, onchange) {
  return h('input', {
    class: 'input score-input',
    type: 'number',
    step: 'any',
    value: target[key] ?? '',
    placeholder: 'Score',
    'aria-label': `Score ${label}`,
    oninput: (ev) => {
      const n = ev.target.value === '' ? null : Number(ev.target.value);
      target[key] = Number.isFinite(n) ? n : null;
      touchEditor();
      onchange();
    },
  });
}

function startNewGame() {
  state.editor = newEditor();
  store.setDraft(state.editor);
  go('game');
}

function openInEditor(record) {
  state.editor = {
    date: record.date,
    location: record.location || '',
    rows: [{ ...structuredClone(record) }],
    active: 0,
    editing: true,
    dirty: false,
  };
  store.setDraft(state.editor);
  go('game');
}

function saveEditor() {
  const e = state.editor;
  const sports = sportsMap();
  const rows = e.rows.filter((row) => !rowIsEmpty(row));
  if (!rows.length) {
    alert('Aucune partie à enregistrer.');
    return;
  }
  const records = rows.map((row) => rowToRecord(e, row));
  const check = (r) => {
    const owner = normalize(r.owner || store.getMe());
    const self = r.opponents.some((o) => normalize(o.name.trim()) === owner);
    return [...validate(r), ...(self ? [`${r.owner || 'Tu'} ne peut pas être son propre adversaire.`] : [])];
  };
  const errors = records.flatMap((r, i) => check(r).map((msg) => (e.rows.length > 1 ? `Partie ${e.rows.indexOf(rows[i]) + 1} : ${msg}` : msg)));
  if (errors.length) {
    alert(errors.join('\n'));
    return;
  }
  // Heures de creation decalees pour garder l'ordre de saisie dans la journee
  const base = Date.now();
  const stamped = records.map((r, i) => ({ ...r, createdAt: r.createdAt || new Date(base + i).toISOString() }));
  if (!persistOrWarn(() => stamped.forEach((r) => store.saveGame(r)))) return;
  store.requestPersistence();
  const results = stamped.map((r) => outcome(r, sports.get(r.sport)).result);
  const count = (x) => results.filter((r) => r === x).length;
  toast(
    e.editing
      ? `Partie modifiée · ${RESULTS[results[0]][2]}`
      : `${plural(stamped.length, 'partie')} enregistrée${stamped.length > 1 ? 's' : ''} · ${count('W')} V${count('D') ? ` · ${count('D')} N` : ''} · ${count('L')} D`,
  );
  state.editor = newEditor(e.editing ? null : stamped.at(-1));
  store.setDraft(state.editor);
  if (e.editing) go('history');
  else rerenderKeepScroll();
}

// Joueurs du jour : ceux des parties de la journee (enregistrees ou en cours), ceux ajoutes, puis quelques habitues.
// Toucher un joueur l'ajoute comme adversaire de la partie selectionnee ; le retoucher le retire.
function dayChips(e, dayGames, toggle, addNew) {
  const present = [
    ...new Set([
      ...dayGames.flatMap((g) => g.opponents.map((o) => o.name)),
      ...e.rows.flatMap((r) => r.opponents.map((o) => o.name)).filter(Boolean),
      ...store.getDayPlayers(e.date),
    ]),
  ];
  const inRow = e.rows[e.active].opponents.map((o) => o.name);
  const regulars = playersByFrequency()
    .filter((n) => !present.includes(n))
    .slice(0, Math.max(0, 8 - present.length));
  const chip = (name, suggested) =>
    h(
      'button',
      {
        class: `pchip ${inRow.includes(name) ? 'opponent' : ''} ${suggested ? 'suggest' : ''}`,
        'aria-pressed': String(inRow.includes(name)),
        onclick: () => toggle(name),
      },
      h('span', {}, name),
      inRow.includes(name) ? h('span', { class: 'pchip-role' }, 'Adversaire') : null,
    );
  return h(
    'section',
    { class: 'card day-players' },
    h(
      'div',
      { class: 'day-head' },
      h('h2', { class: 'card-title' }, 'Joueurs du jour'),
      h('span', { class: 'muted small' }, `${e.rows.length > 1 ? `Partie ${e.active + 1} : t` : 'T'}ouche les adversaires`),
    ),
    h(
      'div',
      { class: 'pchips' },
      present.map((n) => chip(n, false)),
      regulars.map((n) => chip(n, true)),
      h('button', { class: 'pchip add', onclick: () => openPlayerPicker('Ajouter un adversaire', '', [...present, ...inRow], addNew) }, '➕ Joueur'),
    ),
  );
}

function dayGamesCard(date, dayGames, sports) {
  const day = byDay(dayGames, sports)[0];
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'day-head' },
      h('h2', { class: 'card-title' }, `Déjà enregistrées ${date === today() ? 'aujourd’hui' : `le ${shortDate(date)}`}`),
      dayScore(day),
    ),
    h('ul', { class: 'match-list' }, day.games.map((g) => h('li', {}, gameItem(g, sports, () => openGameActions(g))))),
  );
}

// Une partie : le sport, moi, puis chaque adversaire avec son score a droite
function gameRow(e, row, i, sports, { select, toggleOpponent }) {
  const status = h('span', { class: 'mrow-pill' }, rowStatus(row, sports));
  const refresh = () => status.replaceChildren(...(rowStatus(row, sports) || []).filter(Boolean));
  const taken = row.opponents.map((o) => o.name);

  const sportSelect = h(
    'select',
    {
      class: 'input',
      'aria-label': 'Sport ou jeu',
      onchange: (ev) => {
        if (ev.target.value === '__new') {
          ev.target.value = row.sport;
          openSportSheet(null, (saved) => {
            row.sport = saved.id;
            touchEditor();
            rerenderKeepScroll();
          });
          return;
        }
        row.sport = ev.target.value;
        touchEditor();
        refresh();
      },
    },
    row.sport ? null : h('option', { value: '', selected: true, disabled: true }, 'Choisir…'),
    store.getSports().map((s) => h('option', { value: s.id, selected: s.id === row.sport }, sportLabel(s))),
    h('option', { value: '__new' }, '➕ Nouveau sport ou jeu…'),
  );

  return h(
    'section',
    {
      class: `card mrow ${i === e.active ? 'active' : ''}`,
      onfocusin: () => select(i),
      onclick: () => select(i),
    },
    h(
      'div',
      { class: 'mrow-head' },
      h('span', { class: 'mrow-title' }, e.editing ? 'Partie' : `Partie ${i + 1}`),
      status,
      e.rows.length > 1
        ? h(
            'button',
            {
              class: 'icon-btn',
              'aria-label': `Retirer la partie ${i + 1}`,
              onclick: (ev) => {
                ev.stopPropagation();
                if (!rowIsEmpty(row) && !confirm(`Retirer la partie ${i + 1} de la saisie ?`)) return;
                e.rows.splice(i, 1);
                e.active = Math.min(e.active, e.rows.length - 1);
                touchEditor();
                rerenderKeepScroll();
              },
            },
            '✕',
          )
        : null,
    ),
    sportSelect,
    h(
      'div',
      { class: 'prow' },
      h('div', { class: 'slot me' }, h('span', { class: 'slot-label' }, row.owner ? 'Joueur' : 'Moi'), h('span', { class: 'slot-name' }, row.owner || meLabel())),
      scoreInput(row, 'me', 'moi', refresh),
      h('span', {}),
      row.opponents.map((o, k) => [
        h(
          'button',
          {
            class: 'slot filled',
            onclick: () =>
              openPlayerPicker(`Adversaire ${k + 1}`, o.name, taken.filter((n) => n !== o.name), (name) => {
                if (!name) row.opponents.splice(k, 1);
                else {
                  o.name = name;
                  store.addDayPlayer(e.date, name);
                }
                touchEditor();
                rerenderKeepScroll();
              }),
          },
          h('span', { class: 'slot-label' }, `Adversaire ${row.opponents.length > 1 ? k + 1 : ''}`),
          h('span', { class: 'slot-name' }, o.name),
        ),
        scoreInput(o, 'score', o.name, refresh),
        h(
          'button',
          {
            class: 'icon-btn',
            'aria-label': `Retirer ${o.name}`,
            onclick: () => {
              row.opponents.splice(k, 1);
              touchEditor();
              rerenderKeepScroll();
            },
          },
          '✕',
        ),
      ]),
    ),
    h(
      'button',
      {
        class: 'btn small ghost',
        onclick: () => {
          select(i);
          openPlayerPicker('Ajouter un adversaire', '', taken, (name) => name && toggleOpponent(i, name));
        },
      },
      '➕ Adversaire',
    ),
  );
}

// Version de l'application (js/version.js)
const versionTag = () => (self.APP_VERSION ? h('span', { class: 'version' }, self.APP_VERSION) : null);

function renderGameView() {
  const e = state.editor;
  const sports = sportsMap();

  if (!sports.size) {
    return h(
      'div',
      { class: 'stack' },
      h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Parties du jour'), versionTag())),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Bienvenue !'),
        h('p', { class: 'muted' }, 'Commence par ajouter les sports et les jeux que tu pratiques : squash, échecs, belote…'),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () =>
              openSportSheet(null, (saved) => {
                e.rows.forEach((row) => (row.sport ||= saved.id));
                store.setDraft(e);
                rerenderKeepScroll();
              }),
          },
          '➕ Ajouter un sport ou un jeu',
        ),
      ),
    );
  }

  const editingIds = e.rows.map((row) => row.id).filter(Boolean);
  const dayGames = chronological(store.getGames().filter((g) => g.date === e.date && !editingIds.includes(g.id)));

  const toggleOpponent = (i, name) => {
    const row = e.rows[i];
    const k = row.opponents.findIndex((o) => o.name === name);
    if (k >= 0) row.opponents.splice(k, 1);
    else {
      row.opponents.push({ name, score: null });
      store.addDayPlayer(e.date, name);
    }
    e.active = i;
    touchEditor();
    rerenderKeepScroll();
  };
  // Selectionne la partie qui recoit les joueurs du jour, sans tout redessiner (le clavier reste ouvert)
  const select = (i) => {
    if (e.active === i) return;
    e.active = i;
    store.setDraft(e);
    document.querySelectorAll('.mrow').forEach((el, k) => el.classList.toggle('active', k === i));
    document.querySelector('.day-players')?.replaceWith(chips());
  };
  const chips = () =>
    dayChips(
      e,
      dayGames,
      (name) => toggleOpponent(e.active, name),
      (name) => name && toggleOpponent(e.active, name),
    );

  const locations = [...new Set(store.getGames().map((g) => g.location).filter(Boolean))];
  const count = e.rows.filter((row) => !rowIsEmpty(row)).length;

  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'view-head' },
      h(
        'div',
        {},
        h('h1', {}, e.editing ? 'Modifier la partie' : 'Parties du jour'),
        e.editing ? null : versionTag(),
        e.dirty ? h('span', { class: 'pill warn' }, 'Brouillon') : null,
      ),
      !e.editing && e.dirty ? h('button', { class: 'btn small ghost', onclick: () => confirm('Effacer cette saisie ?') && startNewGame() }, 'Effacer') : null,
    ),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'grid2' },
        field(
          'Date',
          h('input', {
            class: 'input',
            type: 'date',
            value: e.date,
            onchange: (ev) => {
              e.date = ev.target.value || today();
              touchEditor();
              rerenderKeepScroll();
            },
          }),
        ),
        field(
          'Lieu',
          h('input', {
            class: 'input',
            list: 'locations',
            placeholder: 'Facultatif',
            value: e.location,
            oninput: (ev) => {
              e.location = ev.target.value;
              touchEditor();
            },
          }),
        ),
      ),
      h('datalist', { id: 'locations' }, locations.map((l) => h('option', { value: l }))),
    ),
    chips(),
    e.rows.map((row, i) => gameRow(e, row, i, sports, { select, toggleOpponent })),
    e.editing
      ? null
      : h(
          'button',
          {
            class: 'btn add-match',
            onclick: () => {
              e.rows.push(emptyRow(e.rows.at(-1).sport));
              e.active = e.rows.length - 1;
              touchEditor();
              rerenderKeepScroll();
            },
          },
          '➕ Ajouter une partie',
        ),
    dayGames.length ? dayGamesCard(e.date, dayGames, sports) : null,
    h(
      'div',
      { class: 'action-bar' },
      e.editing ? h('button', { class: 'btn', onclick: () => (!e.dirty || confirm('Abandonner les modifications ?')) && startNewGame() }, 'Annuler') : null,
      h(
        'button',
        { class: 'btn primary grow', onclick: saveEditor },
        e.editing ? '💾 Enregistrer les modifications' : count > 1 ? `💾 Enregistrer les ${count} parties` : '💾 Enregistrer',
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Vue "Historique" : parties regroupees par jour
// ---------------------------------------------------------------------------

function dayScore(t) {
  return h(
    'span',
    { class: 'day-score' },
    h('span', { class: 'ok-text' }, `${t.wins} V`),
    t.draws ? [' · ', h('span', { class: 'muted' }, `${t.draws} N`)] : null,
    ' · ',
    h('span', { class: 'bad-text' }, `${t.losses} D`),
  );
}

function gameItem(g, sports, onclick) {
  const sport = sports.get(g.sport);
  const o = outcome(g, sport);
  return h(
    onclick ? 'button' : 'div',
    { class: `match-item ${onclick ? '' : 'static'}`, onclick },
    resultPill(o.result),
    h(
      'span',
      { class: 'match-main' },
      h('span', { class: 'match-name' }, sportLabel(sport), o.size > 2 ? h('span', { class: 'muted' }, ` · ${placeText(o.rank, o.size)}`) : null),
      h('span', { class: 'muted' }, `vs ${g.opponents.map((x) => x.name).join(', ')}`),
    ),
    h('span', { class: 'match-score' }, scoreText(g)),
  );
}

// Joueurs du meilleur au moins bon
function ranking(g, sport) {
  return [...g.players].sort((a, b) => (sport?.lowerWins ? a.score - b.score : b.score - a.score));
}

// Partie du groupe a laquelle je n'ai pas participe : vainqueur(s) au lieu de V / N / D
function groupGameItem(g, sports, onclick) {
  const sport = sports.get(g.sport);
  const ranked = ranking(g, sport);
  const winners = ranked.filter((p) => p.score === ranked[0].score).map((p) => p.name);
  return h(
    'button',
    { class: 'match-item', onclick },
    h('span', { class: 'result neutral', title: 'Partie du groupe' }, '·'),
    h(
      'span',
      { class: 'match-main' },
      h('span', { class: 'match-name' }, sportLabel(sport), h('span', { class: 'muted' }, ` · 🏆 ${winners.join(', ')}${winners.length > 1 ? ' (égalité)' : ''}`)),
      h('span', { class: 'muted' }, g.players.map((p) => p.name).join(' vs ')),
    ),
    h('span', { class: 'match-score' }, ranked.map((p) => formatScore(p.score)).join(' · ')),
  );
}

// g : partie vue par moi (avec me / opponents) ou partie du groupe (players seulement)
function openGameActions(g) {
  const sports = sportsMap();
  const sport = sports.get(g.sport);
  const mine = g.me !== undefined ? g : store.perspective(g, store.myPid());
  const o = mine ? outcome(mine, sport) : null;
  const myPid = store.myPid();
  const lines = ranking(g, sport).map((p) => ({ ...p, me: p.pid === myPid }));
  const editable = store.canEdit(g);
  // Un administrateur peut modifier une partie sans y avoir joue : on la saisit du point de vue du premier joueur
  const editTarget = mine || (editable && g.players.length ? { ...store.perspective(g, g.players[0].pid), owner: g.players[0].name } : null);
  openSheet(o ? `${sportLabel(sport)} · ${RESULTS[o.result][2]}` : sportLabel(sport), (close) => ({
    body: [
      h(
        'dl',
        { class: 'kv' },
        h('dt', {}, 'Date'),
        h('dd', {}, longDate(g.date)),
        g.location ? [h('dt', {}, 'Lieu'), h('dd', {}, g.location)] : null,
        o && o.size > 2 ? [h('dt', {}, 'Place'), h('dd', {}, placeText(o.rank, o.size))] : null,
        g.createdByName ? [h('dt', {}, 'Saisie par'), h('dd', {}, g.createdByName)] : null,
      ),
      h(
        'table',
        { class: 'table' },
        h(
          'tbody',
          {},
          lines.map((l) => h('tr', {}, h('td', {}, l.me ? h('strong', {}, l.name) : l.name), h('td', { class: 'num' }, l.me ? h('strong', {}, String(l.score)) : String(l.score)))),
        ),
      ),
      g.comments ? h('p', { class: 'comment' }, g.comments) : null,
      editable
        ? null
        : h('p', { class: 'muted small' }, 'Seuls l’auteur de la partie, ses joueurs et les administrateurs peuvent la modifier ou la supprimer.'),
      h(
        'div',
        { class: 'menu', hidden: !editable },
        editTarget
          ? h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  await close();
                  openInEditor(editTarget);
                },
              },
              '✏️ Modifier',
            )
          : null,
        h(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              if (!confirm('Supprimer définitivement cette partie ?')) return;
              store.deleteGame(g.id);
              const row = state.editor.rows.find((r) => r.id === g.id);
              if (row) {
                row.id = null;
                row.createdAt = null;
                state.editor.editing = false;
                state.editor.dirty = true;
                store.setDraft(state.editor);
              }
              await close();
              render();
              toast('Partie supprimée');
            },
          },
          '🗑️ Supprimer',
        ),
      ),
    ],
  }));
}

function sportFilter(value, onchange) {
  const sports = store.getSports();
  return h(
    'select',
    { class: 'input', 'aria-label': 'Sport', onchange: (ev) => onchange(ev.target.value) },
    h('option', { value: '', selected: !value }, 'Tous les sports'),
    sports.map((s) => h('option', { value: s.id, selected: s.id === value }, sportLabel(s))),
  );
}

function renderHistoryView() {
  const sports = sportsMap();
  const scope = state.historyScope || (store.isAdmin() ? 'all' : 'mine');
  const group = scope === 'all';
  const all = group ? store.getAllGames() : store.getGames();
  const q = normalize(state.historyQuery);
  const filtered = all.filter(
    (g) =>
      (!state.historySport || g.sport === state.historySport) &&
      (!q || normalize(`${g.players.map((p) => p.name).join(' ')} ${g.location || ''} ${g.date} ${sports.get(g.sport)?.name || ''}`).includes(q)),
  );

  let content;
  if (!filtered.length) {
    content = h('p', { class: 'muted pad' }, all.length ? 'Aucune partie ne correspond à la recherche.' : 'Aucune partie pour l’instant. Saisis ta première partie dans l’onglet Partie.');
  } else if (group) {
    // Tout le groupe : mes parties avec V / N / D, les autres avec le vainqueur
    const myPid = store.myPid();
    const days = new Map();
    for (const g of chronological(filtered).reverse()) {
      if (!days.has(g.date)) days.set(g.date, []);
      days.get(g.date).push(g);
    }
    content = [...days.entries()].map(([date, list]) =>
      h(
        'section',
        { class: 'day' },
        h('div', { class: 'day-head' }, h('h2', {}, longDate(date)), h('span', { class: 'muted small' }, plural(list.length, 'partie'))),
        h(
          'ul',
          { class: 'match-list' },
          list.map((g) => {
            const mine = store.perspective(g, myPid);
            return h('li', {}, mine ? gameItem(mine, sports, () => openGameActions(mine)) : groupGameItem(g, sports, () => openGameActions(g)));
          }),
        ),
      ),
    );
  } else {
    content = byDay(filtered, sports).map((d) =>
      h(
        'section',
        { class: 'day' },
        h('div', { class: 'day-head' }, h('h2', {}, longDate(d.date)), dayScore(d)),
        h('ul', { class: 'match-list' }, d.games.map((g) => h('li', {}, gameItem(g, sports, () => openGameActions(g))))),
      ),
    );
  }

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Historique'), h('span', { class: 'muted' }, plural(all.length, 'partie'))),
    segmented(
      [
        ['mine', 'Mes parties'],
        ['all', 'Tout le groupe'],
      ],
      scope,
      (k) => {
        state.historyScope = k;
        try {
          localStorage.setItem('sl.historyScope', k);
        } catch {
          // non critique
        }
        rerenderKeepScroll();
      },
    ),
    all.length
      ? h(
          'div',
          { class: 'filters' },
          h('input', {
            type: 'search',
            class: 'input',
            id: 'history-search',
            placeholder: 'Rechercher (joueur, lieu, date)…',
            value: state.historyQuery,
            oninput: (e) => {
              state.historyQuery = e.target.value;
              const pos = e.target.selectionStart;
              rerenderKeepScroll();
              const input = document.getElementById('history-search');
              input.focus();
              input.setSelectionRange(pos, pos);
            },
          }),
          sportFilter(state.historySport, (v) => {
            state.historySport = v;
            rerenderKeepScroll();
          }),
        )
      : null,
    content,
  );
}

// ---------------------------------------------------------------------------
// Vue "Stats"
// ---------------------------------------------------------------------------

const PERIODS = {
  all: { label: 'Tout', from: () => '' },
  year: { label: 'Cette année', from: () => `${new Date().getFullYear()}-01-01` },
  month: {
    label: '30 jours',
    from: () => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
  },
};

// Parties de la periode ; sport = '' pour tous les sports
function periodGames(sport = state.sport) {
  const from = PERIODS[state.period].from();
  return store.getGames(statsPid()).filter((g) => g.date >= from && (!sport || g.sport === sport));
}

// Joueur dont on affiche les stats : moi, ou un autre joueur du groupe
const statsPid = () => state.statsPid || store.myPid();

function statsPlayerSelect() {
  const counts = new Map();
  for (const g of store.getAllGames()) for (const p of g.players) counts.set(p.pid, { name: p.name, n: (counts.get(p.pid)?.n || 0) + 1 });
  const me = store.myPid();
  const others = [...counts.entries()].filter(([pid]) => pid !== me).sort((a, b) => a[1].name.localeCompare(b[1].name, 'fr'));
  if (!others.length) return null;
  return h(
    'select',
    {
      class: 'input',
      'aria-label': 'Joueur',
      onchange: (ev) => {
        state.statsPid = ev.target.value;
        state.sport = '';
        rerenderKeepScroll();
      },
    },
    h('option', { value: '', selected: !state.statsPid }, `👤 Mes stats (${meLabel()})`),
    others.map(([pid, c]) => h('option', { value: pid, selected: pid === state.statsPid }, `Stats de ${c.name}`)),
  );
}

function segmented(options, value, onchange) {
  return h(
    'div',
    { class: 'segmented', role: 'tablist', style: `grid-template-columns: repeat(${options.length}, 1fr)` },
    options.map(([key, label]) => h('button', { role: 'tab', 'aria-selected': String(key === value), onclick: () => onchange(key) }, label)),
  );
}

function tile(value, label, cls = '') {
  return h('div', { class: `tile ${cls}` }, h('span', { class: 'tile-value' }, value), h('span', { class: 'tile-label' }, label));
}

function rateBar(t) {
  return h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width: ${Math.round(winRate(t) * 100)}%` }));
}

const formatScore = (n) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

function recordText(t) {
  return `${t.wins} V${t.draws ? ` · ${t.draws} N` : ''} · ${t.losses} D (${percent(t)})`;
}

// columns : colonnes supplementaires [{ label, value: (t) => texte }]
function tallyTable(tallies, { label = 'Joueur', onRow, columns = [] } = {}) {
  if (!tallies.length) return h('p', { class: 'muted' }, 'Aucune donnée.');
  const draws = tallies.some((t) => t.draws);
  return h(
    'table',
    { class: 'table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, label),
        h('th', { class: 'num' }, 'J'),
        h('th', { class: 'num' }, 'V'),
        draws ? h('th', { class: 'num' }, 'N') : null,
        h('th', { class: 'num' }, 'D'),
        h('th', { class: 'num' }, '%'),
        columns.map((c) => h('th', { class: 'num' }, c.label)),
      ),
    ),
    h(
      'tbody',
      {},
      tallies.map((t) =>
        h(
          'tr',
          {},
          h('td', {}, onRow ? h('button', { class: 'link', onclick: () => onRow(t) }, t.icon ? `${t.icon} ${t.name}` : t.name) : t.icon ? `${t.icon} ${t.name}` : t.name, rateBar(t)),
          h('td', { class: 'num' }, t.played),
          h('td', { class: 'num ok-text' }, t.wins),
          draws ? h('td', { class: 'num muted' }, t.draws) : null,
          h('td', { class: 'num bad-text' }, t.losses),
          h('td', { class: 'num' }, percent(t)),
          columns.map((c) => h('td', { class: 'num' }, c.value(t))),
        ),
      ),
    ),
  );
}

function openOpponentSheet(name) {
  const sports = sportsMap();
  const p = opponentProfile(periodGames(), sports, name);
  const sport = sports.get(state.sport);
  openSheet(state.sport ? `${name} · ${sport?.name}` : name, () => ({
    body: [
      h('div', { class: 'tiles two' }, tile(percent(p.total), 'Face-à-face gagnés'), tile(p.total.played, 'Parties ensemble')),
      h('p', { class: 'center' }, recordText(p.total)),
      !state.sport && p.perSport.length > 1 ? h('section', { class: 'report-section' }, h('h3', {}, 'Par sport'), tallyTable(p.perSport, { label: 'Sport' })) : null,
      h('h3', { class: 'sub-title' }, 'Parties'),
      h(
        'ul',
        { class: 'match-list' },
        p.games.map((g) => h('li', {}, gameItem(g, sports))),
      ),
    ],
  }));
}

function highlightRow(icon, label, t, detail, onclick) {
  if (!t) return null;
  return h(
    'button',
    { class: 'highlight', onclick },
    h('span', { class: 'highlight-icon', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'match-main' }, h('span', { class: 'muted small' }, label), h('span', { class: 'match-name' }, t.icon ? `${t.icon} ${t.name}` : t.name)),
    h('span', { class: 'match-score' }, detail(t)),
  );
}

function renderStatsView() {
  const sports = sportsMap();
  const sport = sports.get(state.sport) || null;
  if (state.sport && !sport) state.sport = '';
  const games = periodGames();
  const sum = summary(games, sports);
  const hl = highlights(games, sports);
  const played = new Set(store.getGames(statsPid()).map((g) => g.sport));
  const selectSport = (id) => {
    state.sport = id;
    rerenderKeepScroll();
  };

  const sportTabs = h(
    'div',
    { class: 'sport-tabs', role: 'tablist' },
    h('button', { role: 'tab', 'aria-selected': String(!state.sport), onclick: () => selectSport('') }, '🏅 Tous'),
    store
      .getSports()
      .filter((s) => played.has(s.id))
      .map((s) => h('button', { role: 'tab', 'aria-selected': String(s.id === state.sport), onclick: () => selectSport(s.id) }, sportLabel(s))),
  );

  let body;
  if (!games.length) {
    body = h('p', { class: 'muted pad' }, store.getGames(statsPid()).length ? 'Aucune partie sur cette période.' : 'Aucune partie pour l’instant.');
  } else {
    const streak = sum.streak.length ? `${sum.streak.length} ${RESULTS[sum.streak.result][1]}` : '–';
    const scores = sport ? scoreStats(games, sport) : null;
    const sizes = sport ? byTableSize(games, sports) : [];
    body = [
      h(
        'div',
        { class: 'tiles four' },
        tile(sum.played, 'Parties'),
        tile(sum.wins, 'Victoires', 'ok'),
        tile(sum.losses, 'Défaites', 'bad'),
        tile(percent(sum), '% victoires'),
      ),
      sum.draws ? h('p', { class: 'muted small center draws-note' }, `et ${sum.draws} nul${sum.draws > 1 ? 's' : ''}`) : null,
      scores
        ? h(
            'section',
            { class: 'card' },
            h('h2', { class: 'card-title' }, 'Scores'),
            h(
              'div',
              { class: sum.avgRank ? 'tiles' : 'tiles two' },
              tile(formatScore(scores.average), 'Score moyen'),
              tile(formatScore(scores.record.me), `Record · ${shortDate(scores.record.date)}`),
              sum.avgRank ? tile(formatScore(sum.avgRank), 'Place moyenne') : null,
            ),
            sport.lowerWins ? h('p', { class: 'muted small' }, 'Le plus petit score gagne : le record est le score le plus bas.') : null,
          )
        : null,
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'row between' }, h('h2', { class: 'card-title' }, 'Forme'), h('span', { class: 'muted small' }, `Série : ${streak} · record ${sum.bestStreak} V`)),
        h('div', { class: 'form-row' }, sum.form.map((r) => resultPill(r))),
        h('p', { class: 'muted small' }, '10 dernières parties, de la plus ancienne à la plus récente.'),
      ),
      sport
        ? null
        : h(
            'section',
            { class: 'card' },
            h('h2', { class: 'card-title' }, 'Par sport'),
            tallyTable(bySport(games, sports), { label: 'Sport', onRow: (t) => selectSport(t.key) }),
          ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Faits marquants'),
        h(
          'div',
          { class: 'highlights' },
          highlightRow('🔥', 'Sport le plus pratiqué', hl.mostPlayedSport, (t) => plural(t.played, 'partie'), () => selectSport(hl.mostPlayedSport.key)),
          highlightRow('🏆', 'Meilleur sport', hl.bestSport, recordText, () => selectSport(hl.bestSport.key)),
          highlightRow('🤝', 'Adversaire le plus fréquent', hl.mostFaced, (t) => plural(t.played, 'partie'), () => openOpponentSheet(hl.mostFaced.name)),
          highlightRow('🎯', 'Victime préférée', hl.favouriteVictim, recordText, () => openOpponentSheet(hl.favouriteVictim.name)),
          highlightRow('👹', 'Bête noire', hl.nemesis, recordText, () => openOpponentSheet(hl.nemesis.name)),
        ),
        h('p', { class: 'muted small' }, 'Classement au % de victoires, à partir de 2 parties (3 pour les sports).'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Face-à-face'),
        tallyTable(byOpponent(games, sports), { label: 'Adversaire', onRow: (t) => openOpponentSheet(t.name) }),
        h('p', { class: 'muted small' }, 'Dans une partie à plusieurs, chaque adversaire compte à part : as-tu fait mieux que lui ?'),
      ),
      sizes.length > 1
        ? h(
            'section',
            { class: 'card' },
            h('h2', { class: 'card-title' }, 'Selon le nombre de joueurs'),
            tallyTable(sizes, { label: 'Table', columns: [{ label: 'Place', value: (t) => formatScore(t.avgRank) }] }),
          )
        : null,
    ];
  }

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Statistiques')),
    statsPlayerSelect(),
    sportTabs,
    segmented(
      Object.entries(PERIODS).map(([k, p]) => [k, p.label]),
      state.period,
      (k) => {
        state.period = k;
        rerenderKeepScroll();
      },
    ),
    body,
  );
}

// ---------------------------------------------------------------------------
// Vue "Reglages" : mon nom, sports, joueurs, sauvegarde
// ---------------------------------------------------------------------------

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (state.view === 'settings') rerenderKeepScroll();
});

// Reservee aux administrateurs (e-mails listes dans config/group.admins)
function adminCard() {
  const acc = store.account();
  const members = store.getMembers();
  const invites = store.getInvites();
  const linked = store
    .getPlayerDetails()
    .filter((p) => p.linked)
    .map((p) => p.name);
  let email = '';

  const choosePlayer = (title, current, onPick) =>
    openPlayerPicker(
      title,
      current,
      linked.filter((n) => n !== current),
      (name) => name && persistOrWarn(() => onPick(name)) && rerenderKeepScroll(),
    );

  // Si la personne est deja membre, on la relie directement ; sinon on cree une invitation
  const assign = () => {
    const clean = email.trim().toLowerCase();
    if (!clean) return alert('Saisis une adresse e-mail.');
    const member = members.find((m) => m.email.toLowerCase() === clean);
    choosePlayer(`Joueur de ${clean}`, '', (name) => {
      if (member) store.linkMember(member.uid, name);
      else store.inviteEmail(clean, name);
      toast(member ? `${clean} est maintenant « ${name} »` : `Invitation créée : ${clean} → ${name}`);
    });
  };

  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title' }, '🔑 Administration'),
    h(
      'dl',
      { class: 'kv' },
      h('dt', {}, 'Code du groupe'),
      h(
        'dd',
        {},
        h('code', {}, acc.code || '–'),
        ' ',
        h(
          'button',
          {
            class: 'icon-btn',
            'aria-label': 'Changer le code du groupe',
            onclick: () => {
              const code = prompt('Nouveau code du groupe (les membres actuels restent membres) :', acc.code);
              if (code && code.trim() !== acc.code && persistOrWarn(() => store.setGroupCode(code))) toast('Code modifié');
            },
          },
          '✏️',
        ),
      ),
    ),

    h('h3', { class: 'sub-title' }, 'Membres'),
    h(
      'ul',
      { class: 'player-list' },
      members.map((m) =>
        h(
          'li',
          {},
          h(
            'span',
            { class: 'member' },
            h('strong', {}, m.playerName || 'Pas encore de joueur'),
            m.revoked ? h('span', { class: 'pill warn' }, 'Révoqué') : null,
            h('span', { class: 'muted small' }, m.email),
          ),
          h('button', { class: 'icon-btn', 'aria-label': `Changer le joueur de ${m.email}`, onclick: () => choosePlayer(`Joueur de ${m.email}`, m.playerName, (name) => store.linkMember(m.uid, name)) }, '👤'),
          m.me
            ? null
            : h(
                'button',
                {
                  class: 'icon-btn',
                  'aria-label': m.revoked ? `Rétablir ${m.email}` : `Révoquer ${m.email}`,
                  title: m.revoked ? 'Rétablir l’accès' : 'Révoquer l’accès',
                  onclick: () => {
                    const question = m.revoked
                      ? `Rétablir l’accès de ${m.email} ?`
                      : `Révoquer l’accès de ${m.email} ?\nCette personne ne pourra plus voir ni saisir de parties. Ses parties restent dans l’historique.`;
                    if (confirm(question) && persistOrWarn(() => store.setRevoked(m.uid, !m.revoked))) toast(m.revoked ? 'Accès rétabli' : 'Accès révoqué');
                  },
                },
                m.revoked ? '↩️' : '🚫',
              ),
        ),
      ),
    ),

    h('h3', { class: 'sub-title' }, 'Attribuer un joueur à un e-mail'),
    h('p', { class: 'muted small' }, 'La personne pourra entrer sans le code du groupe et sera directement reliée à ce joueur.'),
    h(
      'div',
      { class: 'add-player' },
      h('input', {
        class: 'input',
        type: 'email',
        placeholder: 'prenom.nom@gmail.com',
        autocomplete: 'off',
        oninput: (e) => (email = e.target.value),
        onkeydown: (e) => e.key === 'Enter' && assign(),
      }),
      h('button', { class: 'btn primary', onclick: assign }, 'Choisir le joueur'),
    ),
    invites.length
      ? h(
          'ul',
          { class: 'player-list' },
          invites.map((i) =>
            h(
              'li',
              {},
              h('span', { class: 'member' }, h('strong', {}, i.playerName), h('span', { class: 'muted small' }, `${i.email}${i.joined ? ' · inscrit' : ' · en attente'}`)),
              h(
                'button',
                {
                  class: 'icon-btn',
                  'aria-label': `Supprimer l’invitation de ${i.email}`,
                  onclick: () => confirm(`Supprimer l’invitation de ${i.email} ?`) && persistOrWarn(() => store.removeInvite(i.email)),
                },
                '🗑️',
              ),
            ),
          ),
        )
      : null,
  );
}

function renderSettingsView() {
  const games = store.getAllGames();
  const sports = store.getSports();
  const usedSports = new Set(games.map((g) => g.sport));
  const players = store.getPlayerDetails();
  const usedPlayers = new Set(games.flatMap((g) => g.players.map((p) => p.pid)));
  const acc = store.account();
  const legacy = store.legacyBackup();
  let newPlayer = '';

  const addPlayer = () => {
    if (!newPlayer.trim()) return;
    if (persistOrWarn(() => store.addPlayer(newPlayer))) rerenderKeepScroll();
  };

  const runImport = async (backup) => {
    toast('Import en cours…');
    try {
      const res = await store.importLegacy(backup);
      rerenderKeepScroll();
      toast(`${plural(res.added, 'partie')} ajoutée${res.added > 1 ? 's' : ''}, ${res.updated} mise(s) à jour${res.ignored ? `, ${res.ignored} ignorée(s)` : ''}`);
      return true;
    } catch (err) {
      alert(`Import impossible : ${cloudError(err)}`);
      return false;
    }
  };

  const backupInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        await runImport(JSON.parse(await file.text()));
      } catch (err) {
        alert(`Fichier illisible : ${err.message}`);
      }
    },
  });

  const inviteText = `Rejoins le groupe Score Logger : ${location.href.split('#')[0]}\nConnecte-toi avec Google puis saisis le code du groupe : ${acc.code}`;

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Réglages')),
    installPrompt
      ? h(
          'div',
          { class: 'notice' },
          h('p', {}, 'Installe l’application sur l’écran d’accueil pour l’ouvrir en plein écran, même hors connexion.'),
          h(
            'button',
            {
              class: 'btn primary small',
              onclick: async () => {
                installPrompt.prompt();
                await installPrompt.userChoice;
                installPrompt = null;
                rerenderKeepScroll();
              },
            },
            'Installer',
          ),
        )
      : null,
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title' }, 'Mon compte'),
      h(
        'dl',
        { class: 'kv' },
        h('dt', {}, 'Compte'),
        h('dd', {}, acc.email || acc.name),
        h('dt', {}, 'Mon joueur'),
        h(
          'dd',
          {},
          meLabel(),
          ' ',
          h(
            'button',
            {
              class: 'icon-btn',
              'aria-label': 'Changer mon nom de joueur',
              onclick: () => {
                const to = prompt('Ton nom de joueur :', store.getMe());
                if (to && to.trim() !== store.getMe() && persistOrWarn(() => store.renamePlayer(store.getMe(), to))) {
                  rerenderKeepScroll();
                  toast('Nom modifié');
                }
              },
            },
            '✏️',
          ),
        ),
        acc.code ? [h('dt', {}, 'Code du groupe'), h('dd', {}, h('code', {}, acc.code))] : null,
      ),
      h(
        'div',
        { class: 'row wrap' },
        acc.code
          ? h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  try {
                    if (navigator.share) await navigator.share({ text: inviteText });
                    else {
                      await navigator.clipboard.writeText(inviteText);
                      toast('Invitation copiée');
                    }
                  } catch (e) {
                    if (e.name !== 'AbortError') prompt('Copie ce message :', inviteText);
                  }
                },
              },
              '📤 Inviter quelqu’un',
            )
          : null,
        h(
          'button',
          {
            class: 'btn',
            onclick: () => confirm('Se déconnecter de ce téléphone ?') && cloud.signOut(),
          },
          '🚪 Se déconnecter',
        ),
      ),
    ),
    store.isAdmin() ? adminCard() : null,
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row between' }, h('h2', { class: 'card-title' }, 'Sports et jeux'), h('button', { class: 'btn small primary', onclick: () => openSportSheet(null, rerenderKeepScroll) }, '➕ Ajouter')),
      h('p', { class: 'muted small' }, 'Partagés par tout le groupe.'),
      sports.length
        ? h(
            'ul',
            { class: 'player-list' },
            sports.map((s) =>
              h(
                'li',
                {},
                h('span', {}, sportLabel(s), s.lowerWins ? h('span', { class: 'muted small' }, ' · le plus petit score gagne') : null),
                h('button', { class: 'icon-btn', 'aria-label': `Modifier ${s.name}`, onclick: () => openSportSheet(s, rerenderKeepScroll) }, '✏️'),
                h(
                  'button',
                  {
                    class: 'icon-btn',
                    'aria-label': `Supprimer ${s.name}`,
                    disabled: usedSports.has(s.id),
                    title: usedSports.has(s.id) ? 'Des parties utilisent ce sport' : null,
                    onclick: () => {
                      if (confirm(`Supprimer « ${s.name} » ?`) && persistOrWarn(() => store.deleteSport(s.id))) rerenderKeepScroll();
                    },
                  },
                  '🗑️',
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Aucun sport pour l’instant.'),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title' }, 'Joueurs'),
      h('p', { class: 'muted small' }, '👤 = relié à un compte : ce joueur saisit ses propres parties. Lui seul peut changer son nom.'),
      h(
        'div',
        { class: 'add-player' },
        h('input', {
          class: 'input',
          placeholder: 'Prénom Nom',
          oninput: (e) => (newPlayer = e.target.value),
          onkeydown: (e) => e.key === 'Enter' && addPlayer(),
        }),
        h('button', { class: 'btn primary', onclick: addPlayer }, 'Ajouter'),
      ),
      players.length
        ? h(
            'ul',
            { class: 'player-list' },
            players.map((p) =>
              h(
                'li',
                {},
                h('span', {}, p.linked ? '👤 ' : '', p.mine ? h('strong', {}, p.name) : p.name),
                h(
                  'button',
                  {
                    class: 'icon-btn',
                    'aria-label': `Renommer ${p.name}`,
                    disabled: p.linked && !p.mine && !store.isAdmin(),
                    onclick: () => {
                      const to = prompt(`Nouveau nom pour « ${p.name} » (un nom existant fusionne les deux joueurs) :`, p.name);
                      if (to && to.trim() !== p.name && persistOrWarn(() => store.renamePlayer(p.name, to))) {
                        rerenderKeepScroll();
                        toast('Joueur renommé');
                      }
                    },
                  },
                  '✏️',
                ),
                h(
                  'button',
                  {
                    class: 'icon-btn',
                    'aria-label': `Supprimer ${p.name}`,
                    disabled: p.linked || usedPlayers.has(p.pid),
                    title: p.linked ? 'Joueur relié à un compte' : usedPlayers.has(p.pid) ? 'Joueur présent dans des parties' : null,
                    onclick: () => {
                      if (confirm(`Retirer « ${p.name} » de la liste ?`) && persistOrWarn(() => store.removePlayer(p.name))) rerenderKeepScroll();
                    },
                  },
                  '🗑️',
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Aucun joueur. Ils sont aussi ajoutés automatiquement lors de la saisie d’une partie.'),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title' }, 'Sauvegarde'),
      h('p', { class: 'muted' }, 'Les parties sont enregistrées en ligne et partagées par le groupe. Ce téléphone en garde une copie pour fonctionner hors connexion.'),
      legacy
        ? h(
            'div',
            { class: 'notice' },
            h('p', {}, `${plural(legacy.games.length, 'ancienne partie')} enregistrée${legacy.games.length > 1 ? 's' : ''} uniquement sur ce téléphone.`),
            h(
              'button',
              {
                class: 'btn primary small',
                onclick: async () => {
                  if (await runImport(legacy)) {
                    store.markMigrated();
                    rerenderKeepScroll();
                  }
                },
              },
              'Envoyer au groupe',
            ),
          )
        : null,
      backupInput,
      h(
        'div',
        { class: 'row wrap' },
        exportButtons(`scores-groupe-${today()}.json`, () => new Blob([JSON.stringify(store.exportBackup(), null, 2)], { type: 'application/json' })),
        h('button', { class: 'btn', onclick: () => backupInput.click() }, '📥 Importer mes parties'),
      ),
      h('p', { class: 'muted small' }, 'Importer : un fichier exporté par l’ancienne version de l’application, où « Moi » devient ton joueur.'),
    ),
    h('p', { class: 'muted small center' }, 'Score Logger · version partagée'),
  );
}

// ---------------------------------------------------------------------------
// Demarrage : connexion Google, code du groupe, choix de son joueur
// ---------------------------------------------------------------------------

const boot = { user: undefined, member: undefined, synced: false, appShown: false, screen: '' };
let stopMember = null;
let stopSync = null;

function showTabbar(visible) {
  document.getElementById('tabbar').hidden = !visible;
}

// Ecran plein (avant l'application). key evite de redessiner un ecran deja affiche (saisie en cours).
function gate(key, build) {
  if (boot.screen === key) return;
  boot.screen = key;
  boot.appShown = false;
  showTabbar(false);
  document.getElementById('view').replaceChildren(h('div', { class: 'stack gate' }, h('div', { class: 'gate-logo', 'aria-hidden': 'true' }, '🏆'), build()));
}

const loading = (text) => gate(`loading:${text}`, () => h('p', { class: 'muted center' }, text));

function setupScreen() {
  gate('setup', () =>
    h(
      'section',
      { class: 'card' },
      h('h1', {}, 'Score Logger'),
      h('p', {}, 'Firebase n’est pas encore configuré.'),
      h('p', { class: 'muted' }, 'Remplis le fichier js/firebase-config.js avec la configuration de ton projet Firebase (voir le README).'),
    ),
  );
}

function loginScreen() {
  gate('login', () =>
    h(
      'section',
      { class: 'card' },
      h('h1', {}, 'Score Logger'),
      h('p', {}, 'Les scores de tous nos sports et jeux, partagés par le groupe.'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            try {
              await cloud.signIn();
            } catch (e) {
              alert(`Connexion impossible : ${e.message}`);
            }
            btn.disabled = false;
          },
        },
        'Se connecter avec Google',
      ),
    ),
  );
}

function joinScreen() {
  gate('join', () => {
    let code = '';
    const join = async (ev) => {
      if (!code.trim()) return;
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await store.joinGroup(code);
      } catch (e) {
        alert(e?.code === 'permission-denied' ? 'Code incorrect.' : cloudError(e));
        btn.disabled = false;
      }
    };
    const button = h('button', { class: 'btn primary', onclick: join }, 'Rejoindre le groupe');
    return h(
      'section',
      { class: 'card' },
      h('h1', {}, `Bonjour ${boot.user.displayName?.split(' ')[0] || ''} !`),
      h('p', {}, 'Saisis le code du groupe. Demande-le à un membre (Réglages → Inviter quelqu’un).'),
      field('Code du groupe', h('input', { class: 'input', autocomplete: 'off', oninput: (e) => (code = e.target.value), onkeydown: (e) => e.key === 'Enter' && button.click() })),
      button,
      h('button', { class: 'btn ghost small', onclick: () => cloud.signOut() }, 'Changer de compte'),
    );
  });
}

function whoAmIScreen() {
  gate('who', () => {
    const free = store.unclaimedPlayers();
    const suggested = normalize(store.legacyName() || boot.user.displayName?.split(' ')[0] || '');
    let name = store.legacyName() || boot.user.displayName || '';
    const act = async (btn, action) => {
      btn.disabled = true;
      try {
        await action();
      } catch (e) {
        alert(cloudError(e));
        btn.disabled = false;
      }
    };
    return h(
      'section',
      { class: 'card' },
      h('h1', {}, 'Qui es-tu ?'),
      free.length
        ? [
            h('p', { class: 'muted' }, 'Si d’autres ont déjà saisi des parties contre toi, choisis ton nom : ces parties deviennent les tiennes.'),
            h(
              'div',
              { class: 'pchips' },
              free.map((p) =>
                h(
                  'button',
                  {
                    class: `pchip ${normalize(p.name) === suggested ? 'opponent' : ''}`,
                    onclick: (ev) => confirm(`Tu es « ${p.name} » ?`) && act(ev.currentTarget, () => store.claimPlayer(p.pid)),
                  },
                  p.name,
                ),
              ),
            ),
            h('p', { class: 'muted' }, 'Sinon, crée ton joueur :'),
          ]
        : h('p', { class: 'muted' }, 'Choisis le nom sous lequel les autres te verront.'),
      field('Mon nom de joueur', h('input', { class: 'input', value: name, oninput: (e) => (name = e.target.value) })),
      h('button', { class: 'btn primary', onclick: (ev) => act(ev.currentTarget, () => store.createMyPlayer(name)) }, 'Créer mon joueur'),
    );
  });
}

async function showApp() {
  if (boot.appShown) return rerenderKeepScroll();
  boot.appShown = true;
  boot.screen = '';
  showTabbar(true);
  // Les sports et parties viennent d'arriver : la saisie reprend le dernier sport joue
  if (!state.editor.dirty && !state.editor.editing) state.editor = newEditor();
  render();
  const legacy = store.legacyBackup();
  if (legacy && confirm(`${plural(legacy.games.length, 'partie')} sont enregistrées uniquement sur ce téléphone. Les envoyer au groupe maintenant ?`)) {
    toast('Import en cours…');
    try {
      const res = await store.importLegacy(legacy);
      store.markMigrated();
      toast(`${plural(res.added, 'partie')} envoyée${res.added > 1 ? 's' : ''} au groupe`);
    } catch (e) {
      alert(`Import impossible : ${cloudError(e)}\nTu pourras réessayer depuis Réglages → Sauvegarde.`);
    }
    rerenderKeepScroll();
  }
}

// Choisit l'ecran a afficher selon l'etat de connexion
function route() {
  if (boot.user === null) return loginScreen();
  if (boot.user === undefined || boot.member === undefined) return loading('Connexion…');
  if (boot.member === null) {
    // Invite par e-mail ou administrateur : on entre sans code
    if (boot.autoJoin === undefined) {
      boot.autoJoin = 'checking';
      store
        .canJoinWithoutCode()
        .then((ok) => (ok ? store.joinGroup('') : Promise.reject(null)))
        .catch(() => {
          boot.autoJoin = false;
          route();
        });
    }
    return boot.autoJoin === 'checking' ? loading('Connexion…') : joinScreen();
  }
  if (boot.member.revoked) return revokedScreen();
  if (!boot.synced) return loading('Chargement des parties…');
  if (!boot.member.pid) {
    // Joueur attribue a mon e-mail par un administrateur : relie automatiquement
    const assigned = store.assignedPlayer();
    if (assigned && !boot.autoClaim) {
      boot.autoClaim = true;
      store.claimPlayer(assigned.pid).catch(() => whoAmIScreen());
      return loading(`Bienvenue ${assigned.name} !`);
    }
    return whoAmIScreen();
  }
  return showApp();
}

function revokedScreen() {
  gate('revoked', () =>
    h(
      'section',
      { class: 'card' },
      h('h1', {}, 'Accès retiré'),
      h('p', {}, 'Ton accès au groupe a été retiré par un administrateur.'),
      h('button', { class: 'btn', onclick: () => cloud.signOut() }, 'Changer de compte'),
    ),
  );
}

// Donnees modifiees (par moi ou par un autre membre) : on redessine,
// mais pas pendant qu'un champ est en cours de saisie.
let renderQueued = false;
function onDataChange() {
  if (!boot.appShown) {
    boot.screen = '';
    return route();
  }
  if (renderQueued) return;
  renderQueued = true;
  const run = () => {
    const active = document.activeElement;
    if (active && active.closest?.('#view') && active.matches('input, select, textarea')) {
      active.addEventListener('blur', () => setTimeout(run, 0), { once: true });
      return;
    }
    renderQueued = false;
    if (boot.appShown) rerenderKeepScroll();
  };
  requestAnimationFrame(run);
}

async function start() {
  buildTabbar();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (!cloud.isConfigured()) return setupScreen();
  loading('Chargement…');
  try {
    await cloud.init();
  } catch {
    gate('offline', () =>
      h(
        'section',
        { class: 'card' },
        h('p', {}, 'Impossible de charger l’application. Une connexion internet est nécessaire au premier lancement.'),
        h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Réessayer'),
      ),
    );
    return;
  }
  store.setHandlers({ change: onDataChange, error: (e) => toast(cloudError(e)) });

  cloud.onUser((user) => {
    stopMember?.();
    stopSync?.();
    stopMember = stopSync = null;
    Object.assign(boot, { user: user || null, member: undefined, synced: false, autoJoin: undefined, autoClaim: false });
    state.statsPid = '';
    store.setSession(user, null);
    if (!user) return route();
    stopMember = store.watchMember(
      user.uid,
      (member) => {
        boot.member = member;
        store.setSession(user, member);
        if (member?.revoked && stopSync) {
          stopSync();
          stopSync = null;
          boot.synced = false;
          boot.appShown = false;
        }
        if (member && !member.revoked && !stopSync) {
          stopSync = store.startSync(() => {
            boot.synced = true;
            route();
          });
        }
        if (boot.appShown) onDataChange();
        else route();
      },
      (e) => toast(cloudError(e)),
    );
    route();
  });
}

start();

// Exposes pour le debogage dans la console
window.scoreLogger = { store, state };
