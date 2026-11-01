import * as store from './store.js';
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
    alert(`Impossible d'enregistrer sur le téléphone (stockage plein ?).\n${e.message}`);
    return false;
  }
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
  const count = new Map(store.getPlayers().map((n) => [n, 0]));
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
  const errors = records.flatMap((r, i) => validate(r).map((msg) => (e.rows.length > 1 ? `Partie ${e.rows.indexOf(rows[i]) + 1} : ${msg}` : msg)));
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
      h('div', { class: 'slot me' }, h('span', { class: 'slot-label' }, 'Moi'), h('span', { class: 'slot-name' }, meLabel())),
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

function renderGameView() {
  const e = state.editor;
  const sports = sportsMap();

  if (!sports.size) {
    return h(
      'div',
      { class: 'stack' },
      h('div', { class: 'view-head' }, h('h1', {}, 'Parties du jour')),
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
      h('div', {}, h('h1', {}, e.editing ? 'Modifier la partie' : 'Parties du jour'), e.dirty ? h('span', { class: 'pill warn' }, 'Brouillon') : null),
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

function openGameActions(g) {
  const sports = sportsMap();
  const sport = sports.get(g.sport);
  const o = outcome(g, sport);
  const lines = [{ name: meLabel(), score: g.me, me: true }, ...g.opponents].sort((a, b) => (sport?.lowerWins ? a.score - b.score : b.score - a.score));
  openSheet(`${sportLabel(sport)} · ${RESULTS[o.result][2]}`, (close) => ({
    body: [
      h(
        'dl',
        { class: 'kv' },
        h('dt', {}, 'Date'),
        h('dd', {}, longDate(g.date)),
        g.location ? [h('dt', {}, 'Lieu'), h('dd', {}, g.location)] : null,
        o.size > 2 ? [h('dt', {}, 'Place'), h('dd', {}, placeText(o.rank, o.size))] : null,
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
      h(
        'div',
        { class: 'menu' },
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              await close();
              openInEditor(g);
            },
          },
          '✏️ Modifier',
        ),
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
  const all = store.getGames();
  const q = normalize(state.historyQuery);
  const filtered = all.filter(
    (g) =>
      (!state.historySport || g.sport === state.historySport) &&
      (!q || normalize(`${g.opponents.map((o) => o.name).join(' ')} ${g.location || ''} ${g.date} ${sports.get(g.sport)?.name || ''}`).includes(q)),
  );
  const days = byDay(filtered, sports);

  const content = days.length
    ? days.map((d) =>
        h(
          'section',
          { class: 'day' },
          h('div', { class: 'day-head' }, h('h2', {}, longDate(d.date)), dayScore(d)),
          h('ul', { class: 'match-list' }, d.games.map((g) => h('li', {}, gameItem(g, sports, () => openGameActions(g))))),
        ),
      )
    : h('p', { class: 'muted pad' }, all.length ? 'Aucune partie ne correspond à la recherche.' : 'Aucune partie pour l’instant. Saisis ta première partie dans l’onglet Partie.');

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Historique'), h('span', { class: 'muted' }, plural(all.length, 'partie'))),
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
  return store.getGames().filter((g) => g.date >= from && (!sport || g.sport === sport));
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
  const played = new Set(store.getGames().map((g) => g.sport));
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
    body = h('p', { class: 'muted pad' }, store.getGames().length ? 'Aucune partie sur cette période.' : 'Aucune partie pour l’instant.');
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

function renderSettingsView() {
  const games = store.getGames();
  const sports = store.getSports();
  const usedSports = new Set(games.map((g) => g.sport));
  const players = store.getPlayers();
  const usedPlayers = new Set(games.flatMap((g) => g.opponents.map((o) => o.name)));
  let newPlayer = '';

  const addPlayer = () => {
    if (!newPlayer.trim()) return;
    if (persistOrWarn(() => store.addPlayer(newPlayer))) rerenderKeepScroll();
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
        const res = store.importBackup(JSON.parse(await file.text()));
        rerenderKeepScroll();
        toast(`${plural(res.added, 'partie')} ajoutée${res.added > 1 ? 's' : ''}, ${res.updated} mise(s) à jour${res.ignored ? `, ${res.ignored} ignorée(s)` : ''}`);
      } catch (err) {
        alert(`Import impossible : ${err.message}`);
      }
    },
  });

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
      field(
        'Mon prénom',
        h('input', {
          class: 'input',
          placeholder: 'Moi',
          value: store.getMe(),
          onchange: (e) => persistOrWarn(() => store.setMe(e.target.value)) && toast('Prénom enregistré'),
        }),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row between' }, h('h2', { class: 'card-title' }, 'Sports et jeux'), h('button', { class: 'btn small primary', onclick: () => openSportSheet(null, rerenderKeepScroll) }, '➕ Ajouter')),
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
            players.map((name) =>
              h(
                'li',
                {},
                h('span', {}, name),
                h(
                  'button',
                  {
                    class: 'icon-btn',
                    'aria-label': `Renommer ${name}`,
                    onclick: () => {
                      const to = prompt(`Nouveau nom pour « ${name} » (un nom existant fusionne les deux joueurs) :`, name);
                      if (to && to.trim() !== name && persistOrWarn(() => store.renamePlayer(name, to))) {
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
                    'aria-label': `Supprimer ${name}`,
                    disabled: usedPlayers.has(name),
                    title: usedPlayers.has(name) ? 'Joueur présent dans des parties' : null,
                    onclick: () => {
                      if (confirm(`Retirer « ${name} » de la liste ?`) && persistOrWarn(() => store.removePlayer(name))) rerenderKeepScroll();
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
      h('p', { class: 'muted' }, 'Les parties sont stockées uniquement sur ce téléphone. Exporte-les régulièrement : effacer les données de Chrome les supprimerait.'),
      backupInput,
      h(
        'div',
        { class: 'row wrap' },
        exportButtons(`scores-${today()}.json`, () => new Blob([JSON.stringify(store.exportBackup(), null, 2)], { type: 'application/json' })),
        h('button', { class: 'btn', onclick: () => backupInput.click() }, '📥 Importer'),
      ),
      h(
        'button',
        {
          class: 'btn danger',
          onclick: () => {
            if (!confirm('Effacer TOUTES les parties, sports et joueurs de ce téléphone ?')) return;
            if (!confirm('Vraiment ? Cette action est définitive.')) return;
            store.clearAll();
            state.editor = newEditor();
            render();
            toast('Données effacées');
          },
        },
        '🗑️ Tout effacer',
      ),
    ),
    h('p', { class: 'muted small center' }, 'Score Logger · version mobile'),
  );
}

// ---------------------------------------------------------------------------
// Demarrage
// ---------------------------------------------------------------------------

buildTabbar();
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Exposes pour le debogage dans la console
window.scoreLogger = { store, state };
