/* Consommation textile et AESA – application du site.
   1. Le sas déchiffre le contenu (PBKDF2 + AES-GCM avec Web Crypto, rien n'est envoyé).
   2. Les graphiques sont dessinés à la main : SVG pour les courbes, barres HTML animées par transform.
   Ce fichier ne contient aucun résultat : les chiffres arrivent dans le paquet chiffré. */
'use strict';

// Le site ne doit pas être affiché dans un cadre d'un autre site (protection contre le « clickjacking »).
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  try { window.top.location = window.self.location.href; } catch (e) { /* navigation bloquée : la page reste masquée */ }
}

(() => {
  const $ = (sel, racine = document) => racine.querySelector(sel);
  const NS = 'http://www.w3.org/2000/svg';
  const CLE_SESSION = 'textile-aesa-cle';
  const racine = document.documentElement;

  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') racine.dataset.theme = theme;
  } catch (e) { /* stockage indisponible : thème du système */ }

  /* ------------------------------------------------------------ formats */
  const formats = {};
  const ESP = ' ';
  function nb(v, dec = 1) {
    const f = formats[dec] || (formats[dec] = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: dec }));
    return f.format(v);
  }
  const pct = (v, dec = 1) => nb(v, dec) + ESP + '%';
  const euros = v => nb(v, 0) + ESP + '€';
  const signe = (v, dec = 1) => {
    const texte = nb(Math.abs(v), dec);
    return (texte === '0' ? '' : v > 0 ? '+' : '−') + texte;
  };
  const borne = (v, min, max) => Math.min(max, Math.max(min, v));

  /* ------------------------------------------------- création d'éléments */
  function h(tag, props = {}, ...enfants) {
    const el = document.createElement(tag);
    for (const [cle, val] of Object.entries(props)) {
      if (val == null || val === false) continue;
      if (cle === 'classe') el.className = val;
      else if (cle === 'texte') el.textContent = val;
      else if (cle === 'vars') for (const [nom, v] of Object.entries(val)) el.style.setProperty(nom, v);
      else if (cle.startsWith('on')) el.addEventListener(cle.slice(2), val);
      else el.setAttribute(cle, val === true ? '' : val);
    }
    for (const e of enfants.flat()) if (e != null && e !== false) el.append(e);
    return el;
  }
  function s(tag, attrs = {}, parent) {
    const el = document.createElementNS(NS, tag);
    for (const [cle, val] of Object.entries(attrs)) {
      if (val == null) continue;
      if (cle === 'classe') el.setAttribute('class', val);
      else if (cle === 'texte') el.textContent = val;
      else if (cle === 'remplir') el.style.fill = val;
      else el.setAttribute(cle, val);
    }
    if (parent) parent.appendChild(el);
    return el;
  }
  const svgRacine = (l, ht, etiquette) =>
    s('svg', { viewBox: `0 0 ${l} ${ht}`, width: l, height: ht, role: 'img', 'aria-label': etiquette });

  // Générateur pseudo-aléatoire à graine : la penderie a toujours la même allure.
  function alea(graine) {
    let a = graine >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const mouvementReduit = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const apres = (ms, f) => setTimeout(f, mouvementReduit() ? 0 : ms);
  const prochaineImage = f => requestAnimationFrame(() => requestAnimationFrame(f));

  /* ------------------------------------------------------------ infobulle */
  const bulle = $('#infobulle');
  let minuterieBulle;
  function afficherBulle(x, y, titre, texte) {
    bulle.replaceChildren(h('b', { texte: titre }), texte || '');
    bulle.classList.add('visible');
    const r = bulle.getBoundingClientRect();
    let gauche = x + 14, haut = y + 16;
    if (gauche + r.width > innerWidth - 8) gauche = x - r.width - 14;
    if (haut + r.height > innerHeight - 8) haut = y - r.height - 12;
    bulle.style.left = Math.max(8, gauche) + 'px';
    bulle.style.top = Math.max(8, haut) + 'px';
  }
  const masquerBulle = () => bulle.classList.remove('visible');
  function infobulle(el, contenu) {
    el.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') afficherBulle(e.clientX, e.clientY, ...contenu()); });
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') masquerBulle(); });
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      afficherBulle(e.clientX, e.clientY, ...contenu());
      clearTimeout(minuterieBulle);
      minuterieBulle = setTimeout(masquerBulle, 2600);
    });
    el.addEventListener('focus', () => {
      const r = el.getBoundingClientRect();
      afficherBulle(r.left + r.width / 2, r.bottom, ...contenu());
    });
    el.addEventListener('blur', masquerBulle);
  }
  addEventListener('scroll', masquerBulle, { passive: true });

  /* ---------------------------------------------------- commandes communes */
  function segments(conteneur, options, valeur, auChoix) {
    const boutons = options.map(([val, libelle]) => {
      const b = h('button', {
        type: 'button', 'aria-pressed': String(val === valeur), texte: libelle,
        onclick: () => {
          if (b.getAttribute('aria-pressed') === 'true') return;
          boutons.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          auChoix(val);
        },
      });
      return b;
    });
    conteneur.replaceChildren(...boutons);
    return {
      choisir(val) { boutons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === val))); },
    };
  }

  function remplissageCurseur(curseur) {
    const p = (curseur.value - curseur.min) / (curseur.max - curseur.min) * 100;
    curseur.style.setProperty('--pct', p + '%');
  }

  // Redessine un graphique SVG quand la largeur de son conteneur change.
  const dessins = new Map();
  const observateur = new ResizeObserver(entrees => {
    for (const entree of entrees) {
      const d = dessins.get(entree.target);
      const largeur = Math.round(entree.contentRect.width);
      if (!d || !largeur || largeur === d.largeur) continue;
      d.largeur = largeur;
      cancelAnimationFrame(d.image);
      d.image = requestAnimationFrame(() => d.dessiner(largeur));
    }
  });
  function suivreLargeur(el, dessiner) {
    const d = { dessiner, largeur: 0, image: 0 };
    dessins.set(el, d);
    observateur.observe(el);
    // Le premier dessin note sa largeur : l'observateur ne redessine pas tout de suite
    // (ce qui couperait l'animation d'ouverture).
    return () => {
      const largeur = Math.round(el.getBoundingClientRect().width);
      if (largeur) { d.largeur = largeur; dessiner(largeur); }
    };
  }

  function tableau(details, entetes, lignes) {
    const numerique = entetes.map((_, j) => lignes.every(l => typeof l[j] === 'number'));
    const fmt = (v, j) => typeof v === 'number' ? nb(v, 2) : v;
    const table = h('table', {},
      h('thead', {}, h('tr', {}, entetes.map((e, j) => h('th', { classe: numerique[j] ? 'n' : null, scope: 'col', texte: e })))),
      h('tbody', {}, lignes.map(l => h('tr', {}, l.map((v, j) => h('td', { classe: numerique[j] ? 'n' : null, texte: fmt(v, j) }))))));
    details.append(h('div', { classe: 'tableau-defile' }, table));
  }

  const icones = {
    ok: 'M4 12.5l5 5L20 6.5',
    vigilance: 'M12 4l9 16H3zM12 10v4.5M12 17.6v.1',
    anomalie: 'M6 6l12 12M18 6L6 18',
  };
  function icone(statut) {
    const el = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s('path', { d: icones[statut] }, el);
    return el;
  }

  /* ------------------------------------------------------------- penderie */
  // Les vêtements sont vus de profil sur une tringle : une fine silhouette par pièce.
  const TEINTES_PORTEES = ['var(--porte-1)', 'var(--porte-2)', 'var(--porte-3)', 'var(--porte-4)'];

  function creerPenderie(conteneur, { capacite, hauteur = 150, graine = 7, notes = false }) {
    const hasard = alea(graine);
    const formes = Array.from({ length: capacite }, () => ({
      ht: 0.45 + hasard() * 0.55, l: 0.6 + hasard() * 0.3, teinte: Math.floor(hasard() * TEINTES_PORTEES.length),
    }));
    let etat = { portees: 0, dormantes: 0, colorier: null };
    let pieces = [], groupeNotes = null, pas = 0, notesVisibles = false;
    const reserve = notes ? 46 : 0;

    function corps(cx, l, haut, bas) {
      const r = Math.min(l / 2, 3), e = l * 0.4;
      return `M${cx - e},${haut}L${cx + e},${haut}L${cx + l / 2},${bas - r}Q${cx + l / 2},${bas} ${cx + l / 2 - r},${bas}` +
        `L${cx - l / 2 + r},${bas}Q${cx - l / 2},${bas} ${cx - l / 2},${bas - r}Z`;
    }

    function construire(largeur) {
      pas = largeur / capacite;
      const svg = s('svg', { viewBox: `0 0 ${largeur} ${hauteur + reserve}`, width: largeur, height: hauteur + reserve, 'aria-hidden': 'true', focusable: 'false' });
      s('line', { classe: 'tringle', x1: 1, x2: largeur - 1, y1: 6, y2: 6 }, svg);
      pieces = formes.map((f, i) => {
        const cx = pas * (i + 0.5), l = Math.max(1.4, pas * f.l), haut = 15, bas = haut + (hauteur - haut - 4) * f.ht;
        const g = s('g', { classe: 'piece absente' }, svg);
        s('path', { classe: 'crochet', d: pas > 7 ? `M${cx - 2.2},7.5Q${cx},2 ${cx + 2.2},6.5M${cx},7v${haut - 7}` : `M${cx},6v${haut - 6}` }, g);
        s('path', { classe: 'corps', d: corps(cx, l, haut, bas) }, g);
        return g;
      });
      if (notes) groupeNotes = s('g', { classe: notesVisibles ? 'notes visible' : 'notes' }, svg);
      conteneur.replaceChildren(svg);
      appliquer(false);
      if (notesVisibles) dessinerNotes();
    }

    function appliquer(animer, sens = 1) {
      const total = Math.round(etat.portees + etat.dormantes), np = Math.round(etat.portees);
      const pasRetard = animer ? Math.min(14, 650 / Math.max(total, 1)) : 0;
      pieces.forEach((g, i) => {
        const statut = i < np ? 'portee' : i < total ? 'dort' : 'absente';
        const ordre = sens > 0 ? i : total - i;
        g.style.setProperty('--retard', Math.max(0, ordre) * pasRetard + 'ms');
        g.setAttribute('class', 'piece ' + statut);
        const couleur = statut === 'absente' ? null : etat.colorier ? etat.colorier(i, statut) : statut === 'portee' ? TEINTES_PORTEES[formes[i].teinte] : null;
        g.lastChild.style.fill = couleur || '';
      });
    }

    function dessinerNotes() {
      if (!groupeNotes) return;
      groupeNotes.replaceChildren();
      const np = Math.round(etat.portees), total = Math.round(etat.portees + etat.dormantes);
      const y = hauteur + 10;
      const accolade = (x0, x1, texte, ancre) => {
        s('path', { classe: 'accolade', d: `M${x0 + 1},${y}v5H${x1 - 1}v-5M${(x0 + x1) / 2},${y + 5}v5` }, groupeNotes);
        const xt = ancre === 'start' ? x0 : ancre === 'end' ? x1 : (x0 + x1) / 2;
        s('text', { classe: 'note', x: xt, y: y + 28, 'text-anchor': ancre, texte }, groupeNotes);
      };
      accolade(0, np * pas, notes.portees(etat), 'start');
      accolade(np * pas, total * pas, notes.dormantes(etat), 'end');
    }

    const depart = suivreLargeur(conteneur, construire);
    depart();
    return {
      maj(nouvel, { animer = false, sens = 1 } = {}) {
        etat = { ...etat, ...nouvel };
        appliquer(animer && !mouvementReduit(), sens);
      },
      montrerNotes() {
        notesVisibles = true;
        dessinerNotes();
        if (groupeNotes) groupeNotes.classList.add('visible');
      },
    };
  }

  /* ======================================================== APPLICATION */
  function demarrer(D) {
    // Une couleur par profil, dans l'ordre des profils (palette validée pour les daltoniens).
    const COULEURS = Object.fromEntries(D.profils.map((p, i) => [p.id, `var(--p${i + 1})`]));
    const P = Object.fromEntries(D.profils.map(p => [p.id, p]));
    const flux = D.indicateurs.find(i => i.cle === 'Q25_RT');
    const pop = {
      flux: flux.moyenne,
      garde_robe: D.indicateurs.find(i => i.cle === 'STOCK_COMP').moyenne,
      portees: D.indicateurs.find(i => i.cle === 'TOT_PORT').moyenne,
      dormant: D.indicateurs.find(i => i.cle === 'TOT_STOCK').moyenne,
    };

    navigation();
    ouverture(D, pop);
    tache1(D);
    distribution(D, flux);
    concentration(D);
    intervalles(D);
    groupes(D, pop);
    foret(D);
    spearman(D);
    cramer(D);
    profils(D, P, COULEURS);
    scenarios(D, pop);
    simulateur(D, pop);
    etVous(D, P, COULEURS, pop);
  }

  /* ---------------------------------------------------------- navigation */
  function navigation() {
    const liens = [...document.querySelectorAll('.sommaire a')];
    const sommaire = $('.sommaire');
    const sections = liens.map(a => document.getElementById(a.hash.slice(1)));
    const io = new IntersectionObserver(entrees => {
      for (const e of entrees) {
        if (!e.isIntersecting) continue;
        liens.forEach(a => a.setAttribute('aria-current', String(a.hash === '#' + e.target.id)));
        const actif = liens.find(a => a.hash === '#' + e.target.id);
        if (actif && sommaire.scrollWidth > sommaire.clientWidth) {
          sommaire.scrollTo({ left: actif.offsetLeft - 24, behavior: mouvementReduit() ? 'auto' : 'smooth' });
        }
      }
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(sec => sec && io.observe(sec));

    const fil = $('#fil-lecture');
    let attente = false;
    const majFil = () => {
      attente = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      fil.style.transform = `scaleX(${max > 0 ? borne(scrollY / max, 0, 1) : 0})`;
    };
    addEventListener('scroll', () => { if (!attente) { attente = true; requestAnimationFrame(majFil); } }, { passive: true });
    majFil();

    const boutonTheme = $('#bouton-theme');
    const themeActuel = () => racine.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const libelle = () => boutonTheme.setAttribute('aria-label', themeActuel() === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre');
    libelle();
    boutonTheme.addEventListener('click', () => {
      const t = themeActuel() === 'dark' ? 'light' : 'dark';
      racine.dataset.theme = t;
      try { localStorage.setItem('theme', t); } catch (e) { /* sans importance */ }
      libelle();
    });
    $('#bouton-verrou').addEventListener('click', () => {
      try { sessionStorage.removeItem(CLE_SESSION); } catch (e) { /* rien à effacer */ }
      location.replace(location.pathname);
    });
  }

  /* ----------------------------------------------------------- ouverture */
  function ouverture(D, pop) {
    const penderie = creerPenderie($('#penderie-ouverture'), {
      capacite: Math.ceil(pop.garde_robe) + 6, hauteur: 168, graine: 2024,
      notes: {
        portees: () => `${nb(pop.portees)} portées couramment`,
        dormantes: () => `${nb(pop.dormant)} ne sont plus portées`,
      },
    });
    const total = Math.round(pop.garde_robe);
    // Un seul moment chorégraphié : les pièces se suspendent, puis la moitié s'éteint.
    prochaineImage(() => {
      penderie.maj({ portees: total, dormantes: 0 }, { animer: true });
      apres(1150, () => {
        penderie.maj({ portees: pop.portees, dormantes: total - Math.round(pop.portees) }, { animer: true, sens: -1 });
        apres(700, () => penderie.montrerNotes());
      });
    });
  }

  /* ------------------------------------------------------------- tâche 1 */
  function tache1(D) {
    const T = D.tache1;
    const total = T.tri.reduce((a, t) => a + t.nombre, 0);
    $('#tri-variables').replaceChildren(...T.tri.map(t => {
      const bloc = h('div', { tabindex: '0', vars: { '--part': t.nombre, '--c': t.couleur }, classe: t.texte_sombre ? 'texte-sombre' : null },
        h('b', { texte: nb(t.nombre, 0) }), h('small', { texte: t.nom }));
      infobulle(bloc, () => [`${t.code} : ${t.nom} (${nb(t.nombre, 0)})`, t.detail]);
      return bloc;
    }));
    tableau($('#table-tri'), ['Priorité', 'Rôle', 'Variables', 'Part', 'Détail'],
      T.tri.map(t => [t.code, t.nom, t.nombre, pct(t.nombre / total * 100), t.detail]));

    const NOMS = { ok: 'Conforme', vigilance: 'Vigilance', anomalie: 'Anomalie' };
    const COUL = { ok: 'var(--ok)', vigilance: 'var(--vigilance)', anomalie: 'var(--anomalie)' };
    const compte = st => T.controles.filter(c => c.statut === st).length;
    $('#legende-controles').replaceChildren(...['ok', 'vigilance', 'anomalie'].map(st =>
      h('span', { classe: 'statut', vars: { color: COUL[st] } }, icone(st), h('span', { classe: 'texte-encre', texte: `${NOMS[st]} : ${compte(st)}` }))));

    const detail = $('#controle-detail');
    const boutons = T.controles.map(c => h('button', {
      type: 'button', classe: 'controle ' + c.statut, vars: { '--c': COUL[c.statut] },
      'aria-pressed': 'false', 'aria-label': `Contrôle ${c.numero} : ${c.controle} (${NOMS[c.statut]})`, texte: String(c.numero),
      onclick: () => montrer(c),
    }));
    function montrer(c) {
      boutons.forEach((b, i) => b.setAttribute('aria-pressed', String(T.controles[i] === c)));
      detail.replaceChildren(
        h('span', { classe: 'statut', vars: { color: COUL[c.statut] } }, icone(c.statut), `${NOMS[c.statut]}, famille « ${c.famille} »`),
        h('b', { texte: `${c.numero}. ${c.controle}` }),
        h('span', { texte: `Résultat : ${c.resultat}.` }),
        c.action && c.action !== '—' ? h('span', { classe: 'controle-action', texte: `Suite donnée : ${c.action.charAt(0).toLowerCase() + c.action.slice(1)}.` }) : null);
    }
    $('#controles').replaceChildren(...boutons);
    montrer(T.controles.find(c => c.statut === 'anomalie') || T.controles[0]);

    // Écarts relatifs entre rapport et base recalculée
    const lim = 5;
    const pos = v => (borne(v, -lim, lim) + lim) / (2 * lim) * 100;
    const fmtUnite = (v, u) => u === '%' ? pct(v * 100) : u === '€' ? euros(v) : nb(v, 2) + ' ' + u;
    const lignes = T.references.map(r => {
      const piste = h('div', { classe: 'barre-piste ecart-piste' },
        h('i', { classe: 'ecart-zone', vars: { '--de': pos(-2.5) + '%', '--l': (pos(2.5) - pos(-2.5)) + '%' } }),
        h('i', { classe: 'ecart-zero', vars: { '--x': '50%' } }),
        h('b', { classe: 'ecart-point', vars: { '--x': pos(r.ecart_pct) + '%' } }),
        h('span', { classe: 'ecart-val', vars: { '--x': pos(r.ecart_pct) + '%' }, texte: signe(r.ecart_pct) + ESP + '%' }));
      infobulle(piste, () => [r.indicateur, `Rapport : ${fmtUnite(r.rapport, r.unite)} (${r.page}) ; base : ${fmtUnite(r.base, r.unite)}`]);
      return h('div', { classe: 'barre-ligne' }, h('div', { classe: 'barre-nom', texte: r.indicateur }), piste);
    });
    const axe = h('div', { classe: 'barre-ligne axe-ligne', 'aria-hidden': 'true' }, h('div'),
      h('div', { classe: 'axe-graduations' }, [-5, -2.5, 0, 2.5, 5].map(v => h('span', { vars: { '--x': pos(v) + '%' }, texte: signe(v) + ESP + '%' }))));
    $('#graphique-references').replaceChildren(...lignes, axe);
    tableau($('#table-references'), ['Indicateur', 'Rapport', 'Page', 'Base recalculée', 'Écart relatif'],
      T.references.map(r => [r.indicateur, fmtUnite(r.rapport, r.unite), r.page, fmtUnite(r.base, r.unite), signe(r.ecart_pct) + ESP + '%']));
  }

  /* ---------------------------------------------- distribution des achats */
  function distribution(D, flux) {
    const el = $('#graphique-distribution');
    const classes = D.distribution;
    const dessiner = largeur => {
      const H = 260, m = { h: 30, d: 6, b: 28, g: 38 };
      const lp = largeur - m.g - m.d, hp = H - m.h - m.b;
      const xMax = 60, yMax = Math.ceil(Math.max(...classes.map(c => c.pct)) / 4) * 4;
      const x = v => m.g + v / xMax * lp, y = v => m.h + hp - v / yMax * hp;
      const svg = svgRacine(largeur, H, `Distribution des pièces achetées par an. Médiane ${nb(flux.mediane)}, moyenne ${nb(flux.moyenne)}.`);
      const grille = s('g', { classe: 'grille' }, svg);
      for (let t = 0; t <= yMax; t += 4) {
        s('line', { x1: m.g, x2: largeur - m.d, y1: y(t), y2: y(t) }, grille);
        s('text', { x: m.g - 8, y: y(t) + 4, 'text-anchor': 'end', texte: t + ESP + '%' }, svg);
      }
      for (let t = 0; t <= xMax; t += 10) s('text', { x: x(t), y: H - 8, 'text-anchor': t === xMax ? 'end' : 'middle', texte: t === xMax ? '60 et +' : t }, svg);
      const barres = s('g', {}, svg);
      classes.forEach(c => {
        const fin = c.fin ?? xMax, x0 = x(c.debut) + 1, x1 = x(fin) - 1, yh = y(c.pct), yb = y(0), r = Math.min(3, (x1 - x0) / 2, yb - yh);
        const barre = s('path', { classe: 'barre', d: `M${x0},${yb}V${yh + r}Q${x0},${yh} ${x0 + r},${yh}H${x1 - r}Q${x1},${yh} ${x1},${yh + r}V${yb}Z` }, barres);
        const zone = s('rect', { classe: 'zone-survol', x: x(c.debut), width: x(fin) - x(c.debut), y: m.h, height: hp }, svg);
        zone.addEventListener('pointerenter', () => barres.querySelectorAll('.barre').forEach(b => b.classList.toggle('estompee', b !== barre)));
        zone.addEventListener('pointerleave', () => barres.querySelectorAll('.barre').forEach(b => b.classList.remove('estompee')));
        infobulle(zone, () => [c.fin == null ? `${c.debut} pièces et plus` : `De ${c.debut} à ${c.fin} pièces`, `${pct(c.pct)} des Français`]);
      });
      const repere = (v, texte, ancre, ligne) => {
        s('line', { classe: 'reference', x1: x(v), x2: x(v), y1: m.h - 4 + ligne * 14, y2: y(0) }, svg);
        s('text', { classe: 'ref-texte', x: x(v) + (ancre === 'end' ? -5 : 5), y: m.h + 6 + ligne * 14, 'text-anchor': ancre, texte }, svg);
      };
      repere(flux.mediane, `médiane ${nb(flux.mediane)}`, 'end', 0);
      repere(flux.moyenne, `moyenne ${nb(flux.moyenne)}`, 'start', 0);
      repere(flux.p90, `9 sur 10 sous ${nb(flux.p90)}`, 'start', 1);
      el.replaceChildren(svg);
    };
    suivreLargeur(el, dessiner)();
    tableau($('#table-distribution'), ['Pièces par an', 'Part des Français'],
      classes.map(c => [c.fin == null ? `${c.debut} et plus` : `${c.debut} à ${c.fin}`, pct(c.pct)]));
  }

  /* --------------------------------------------------------- concentration */
  function concentration(D) {
    const el = $('#graphique-concentration');
    const pts = [{ x: 0, y: 0 }, ...D.concentration.map(c => ({ x: c.pct_population, y: c.pct_pieces })), { x: 100, y: 100 }];
    const dessiner = largeur => {
      const H = 270, m = { h: 12, d: 14, b: 40, g: 42 };
      const lp = largeur - m.g - m.d, hp = H - m.h - m.b;
      const x = v => m.g + v / 100 * lp, y = v => m.h + hp - v / 100 * hp;
      const svg = svgRacine(largeur, H, `Courbe de concentration : les 10 % plus gros acheteurs réalisent ${pct(pts[1].y)} des achats.`);
      const grille = s('g', { classe: 'grille' }, svg);
      [0, 25, 50, 75, 100].forEach(t => {
        s('line', { x1: m.g, x2: largeur - m.d, y1: y(t), y2: y(t) }, grille);
        s('text', { x: m.g - 8, y: y(t) + 4, 'text-anchor': 'end', texte: t + ESP + '%' }, svg);
        s('text', { x: x(t), y: H - 22, 'text-anchor': t === 0 ? 'start' : t === 100 ? 'end' : 'middle', texte: t + ESP + '%' }, svg);
      });
      s('text', { x: m.g + lp / 2, y: H - 4, 'text-anchor': 'middle', texte: 'part des plus gros acheteurs' }, svg);
      s('line', { classe: 'egalite', x1: x(0), y1: y(0), x2: x(100), y2: y(100) }, svg);
      const chemin = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x)},${y(p.y)}`).join('');
      s('path', { classe: 'aire', d: `${chemin}L${x(100)},${y(0)}Z` }, svg);
      s('path', { classe: 'ligne', d: chemin }, svg);
      pts.slice(1, -1).forEach(p => {
        const point = s('circle', { classe: 'point', cx: x(p.x), cy: y(p.y), r: 5, remplir: 'var(--p1)' }, svg);
        if (p.x === 10 || p.x === 25) {
          s('text', { classe: 'valeur', x: x(p.x) + 9, y: y(p.y) + 16, texte: `${p.x}${ESP}% → ${nb(p.y)}${ESP}%` }, svg);
        }
        const zone = s('circle', { classe: 'zone-survol', cx: x(p.x), cy: y(p.y), r: 16, tabindex: '0' }, svg);
        zone.addEventListener('pointerenter', () => point.setAttribute('r', 7));
        zone.addEventListener('pointerleave', () => point.setAttribute('r', 5));
        infobulle(zone, () => [`Les ${p.x}${ESP}% plus gros acheteurs`, `réalisent ${pct(p.y)} des achats de vêtements`]);
      });
      el.replaceChildren(svg);
    };
    suivreLargeur(el, dessiner)();
  }

  /* ------------------------------------------------- intervalles min / max */
  function intervalles(D) {
    const el = $('#graphique-intervalles');
    const GRANDEURS = [['flux', 'Pièces achetées par an'], ['garde_robe', 'Garde-robe déclarée']];
    let lignes = null, axe = null;
    function afficher(grandeur) {
      const donnees = D.intervalles.filter(r => r.id.startsWith(grandeur + '_'));
      const max = Math.ceil(Math.max(...donnees.map(r => r.haute)) * 1.18 / 10) * 10;
      const p = v => v / max * 100 + '%';
      if (!lignes) {
        lignes = donnees.map(() => {
          const piste = h('div', { classe: 'barre-piste fourchette-piste' },
            h('i', { classe: 'fourchette-seg' }), h('b', { classe: 'fourchette-pt' }), h('span', { classe: 'fourchette-val' }));
          const nom = h('div', { classe: 'barre-nom' });
          const ligne = h('div', { classe: 'barre-ligne' }, nom, piste);
          infobulle(piste, () => [ligne.titre, ligne.detail]);
          return ligne;
        });
        axe = h('div', { classe: 'axe-graduations' });
        el.replaceChildren(...lignes, h('div', { classe: 'barre-ligne axe-ligne', 'aria-hidden': 'true' }, h('div'), axe));
      }
      donnees.forEach((r, i) => {
        const ligne = lignes[i], [nom, piste] = ligne.children;
        nom.textContent = r.statistique;
        ligne.titre = `${r.grandeur} : ${r.statistique.toLowerCase()}`;
        ligne.detail = `estimation basse ${nb(r.basse)}, centre ${nb(r.centre)}, haute ${nb(r.haute)} pièces`;
        piste.children[0].style.setProperty('--de', p(r.basse));
        piste.children[0].style.setProperty('--l', (r.haute - r.basse) / max * 100 + '%');
        piste.children[1].style.setProperty('--x', p(r.centre));
        piste.children[2].style.setProperty('--x', p(r.haute));
        piste.children[2].textContent = r.basse === r.haute ? nb(r.centre) : `${nb(r.basse)} à ${nb(r.haute)}`;
      });
      const pasAxe = max <= 40 ? 5 : max <= 100 ? 20 : 40;
      const graduations = [];
      for (let t = 0; t <= max; t += pasAxe) graduations.push(h('span', { vars: { '--x': p(t) }, texte: nb(t, 0) }));
      axe.replaceChildren(...graduations);
    }
    segments($('#choix-intervalle'), GRANDEURS, 'flux', afficher);
    afficher('flux');
    tableau($('#table-indicateurs'), ['Indicateur', 'n', 'Moyenne', 'Médiane', 'P10', 'P90', 'Rapport ADEME'],
      D.indicateurs.map(i => [i.indicateur, i.n, i.moyenne, i.mediane, i.p10, i.p90, i.rapport_ademe ?? '–']));
  }

  /* ----------------------------------------------------------- groupes */
  function groupes(D, pop) {
    const el = $('#graphique-groupes');
    const dimensions = [...new Set(D.groupes.map(g => g.dimension))];
    const MESURES = [['flux', 'Achats par an'], ['garde_robe', 'Garde-robe']];
    let dimension = dimensions[0], mesure = 'flux', lignes = [];
    const maxi = { flux: Math.max(...D.groupes.map(g => g.flux_moyenne)) * 1.22, garde_robe: Math.max(...D.groupes.map(g => g.garde_robe_moyenne)) * 1.22 };
    const reference = { flux: pop.flux, garde_robe: pop.garde_robe };

    function construire() {
      const donnees = D.groupes.filter(g => g.dimension === dimension);
      lignes = donnees.map(g => {
        const piste = h('div', { classe: 'barre-piste' },
          h('i', { classe: 'barre-remplie', vars: { '--v': 0 } }), h('i', { classe: 'barre-repere' }),
          h('i', { classe: 'barre-ref' }), h('span', { classe: 'barre-valeur' }));
        infobulle(piste, () => {
          const moy = mesure === 'flux' ? g.flux_moyenne : g.garde_robe_moyenne, med = mesure === 'flux' ? g.flux_mediane : g.garde_robe_mediane;
          return [g.modalite, `moyenne ${nb(moy)}, médiane ${nb(med)} pièces ; ${pct(g.poids_pct)} de la population (n = ${nb(g.n, 0)})`];
        });
        return { g, piste, ligne: h('div', { classe: 'barre-ligne' }, h('div', { classe: 'barre-nom', texte: g.modalite }), piste) };
      });
      el.replaceChildren(...lignes.map(l => l.ligne));
      prochaineImage(mettreAJour);
    }
    function mettreAJour() {
      const max = maxi[mesure];
      lignes.forEach(({ g, piste }) => {
        const moy = mesure === 'flux' ? g.flux_moyenne : g.garde_robe_moyenne, med = mesure === 'flux' ? g.flux_mediane : g.garde_robe_mediane;
        const [barre, repere, ref, valeur] = piste.children;
        barre.style.setProperty('--v', moy / max);
        repere.style.setProperty('--x', med / max * 100 + '%');
        ref.style.setProperty('--x', reference[mesure] / max * 100 + '%');
        valeur.style.setProperty('--fin', moy / max * 100 + '%');
        valeur.textContent = nb(moy);
      });
    }
    segments($('#choix-dimension'), dimensions.map(d => [d, d]), dimension, d => { dimension = d; construire(); });
    segments($('#choix-mesure'), MESURES, mesure, m => { mesure = m; mettreAJour(); });
    construire();
    tableau($('#table-groupes'), ['Dimension', 'Groupe', 'n', 'Part (%)', 'Achats moyenne', 'Achats médiane', 'Garde-robe moyenne', 'Garde-robe médiane'],
      D.groupes.map(g => [g.dimension, g.modalite, g.n, g.poids_pct, g.flux_moyenne, g.flux_mediane, g.garde_robe_moyenne, g.garde_robe_mediane]));
  }

  /* ------------------------------------------------- effets (régression) */
  function foret(D) {
    const el = $('#graphique-foret');
    $('#legende-foret').replaceChildren(
      h('span', {}, h('i', { classe: 'rond plein' }), 'écart net (intervalle sans 0)'),
      h('span', {}, h('i', { classe: 'rond vide' }), 'écart incertain'));
    function afficher(modele) {
      const lignes = D.regression[modele];
      const lim = Math.ceil(Math.max(...lignes.map(r => Math.max(Math.abs(r.ic_bas), Math.abs(r.ic_haut)))) / 10) * 10;
      const pos = v => (v + lim) / (2 * lim) * 100;
      const blocs = [];
      let dimension = null;
      for (const r of lignes) {
        if (r.dimension !== dimension) {
          dimension = r.dimension;
          blocs.push(h('div', { classe: 'foret-dimension' }, h('b', { texte: r.dimension }), h('span', { texte: ` référence : ${r.reference}` })));
        }
        const net = r.ic_bas > 0 || r.ic_haut < 0;
        // L'étiquette va du côté où il reste de la place, pour ne jamais sortir du graphique.
        const cote = r.effet_pct >= 0 ? (pos(r.ic_haut) < 80 ? 'droite' : 'gauche') : (pos(r.ic_bas) > 20 ? 'gauche' : 'droite');
        const piste = h('div', { classe: 'barre-piste foret-piste' + (net ? ' net' : '') },
          h('i', { classe: 'ecart-zero', vars: { '--x': '50%' } }),
          h('i', { classe: 'foret-ic', vars: { '--de': pos(r.ic_bas) + '%', '--l': pos(r.ic_haut) - pos(r.ic_bas) + '%' } }),
          h('b', { classe: 'foret-point', vars: { '--x': pos(r.effet_pct) + '%' } }),
          h('span', { classe: 'foret-val ' + cote, vars: { '--x': pos(cote === 'droite' ? r.ic_haut : r.ic_bas) + '%' }, texte: signe(r.effet_pct) + ESP + '%' }));
        infobulle(piste, () => [`${r.modalite} (référence : ${r.reference})`,
          `${signe(r.effet_pct)} % de pièces achetées ; intervalle de confiance de ${signe(r.ic_bas)} à ${signe(r.ic_haut)} %`]);
        blocs.push(h('div', { classe: 'barre-ligne' }, h('div', { classe: 'barre-nom', texte: r.modalite }), piste));
      }
      const axe = h('div', { classe: 'axe-graduations' }, [-lim, -lim / 2, 0, lim / 2, lim].map(v => h('span', { vars: { '--x': pos(v) + '%' }, texte: signe(v, 0) + ESP + '%' })));
      el.replaceChildren(...blocs, h('div', { classe: 'barre-ligne axe-ligne', 'aria-hidden': 'true' }, h('div'), axe));
    }
    segments($('#choix-modele'), [['socio', 'Profil socio-démographique'], ['complet', 'Avec les pratiques']], 'socio', afficher);
    afficher('socio');
  }

  /* ------------------------------------------------------ Spearman */
  function spearman(D) {
    const el = $('#graphique-spearman');
    const lim = 0.6;
    const pos = v => (v + lim) / (2 * lim) * 100;
    $('#legende-spearman').replaceChildren(
      h('span', {}, h('i', { vars: { '--c': 'var(--p1)' } }), 'montent ensemble'),
      h('span', {}, h('i', { vars: { '--c': 'var(--p2)' } }), 'varient en sens contraire'));
    const lignes = [...D.spearman].sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho)).map(c => {
      const positif = c.rho >= 0;
      const piste = h('div', { classe: 'barre-piste spearman-piste' },
        h('i', { classe: 'ecart-zero', vars: { '--x': '50%' } }),
        h('i', { classe: 'sp-barre ' + (positif ? 'positive' : 'negative'), vars: { '--de': (positif ? 50 : pos(c.rho)) + '%', '--l': Math.abs(c.rho) / (2 * lim) * 100 + '%' } }),
        h('span', { classe: 'sp-val ' + (positif ? 'droite' : 'gauche'), vars: { '--x': pos(c.rho) + '%' }, texte: signe(c.rho, 2) }));
      infobulle(piste, () => [`${c.var_a} et ${c.var_b}`, `ρ = ${nb(c.rho, 3)} ; n = ${nb(c.n, 0)}`]);
      return h('div', { classe: 'barre-ligne' }, h('div', { classe: 'barre-nom', texte: `${c.var_a} ↔ ${c.var_b}` }), piste);
    });
    const axe = h('div', { classe: 'barre-ligne axe-ligne', 'aria-hidden': 'true' }, h('div'),
      h('div', { classe: 'axe-graduations' }, [-0.6, -0.3, 0, 0.3, 0.6].map(v => h('span', { vars: { '--x': pos(v) + '%' }, texte: signe(v, 1) }))));
    el.replaceChildren(...lignes, axe);
    tableau($('#table-spearman'), ['Grandeur A', 'Grandeur B', 'ρ', 'n'], D.spearman.map(c => [c.var_a, c.var_b, c.rho, c.n]));
  }

  /* ---------------------------------------------------------- V de Cramér */
  function cramer(D) {
    const el = $('#graphique-cramer');
    const lignes = [...new Set(D.cramer.map(c => c.profil))];
    const colonnes = [...new Set(D.cramer.map(c => c.consommation))];
    const seuils = [0.05, 0.1, 0.15, 0.2, 0.25];
    const classe = v => 's' + seuils.filter(t => v >= t).length;
    el.style.gridTemplateColumns = `minmax(130px, 1.6fr) repeat(${colonnes.length}, minmax(66px, 1fr))`;
    const cellules = [h('div')];
    colonnes.forEach(c => cellules.push(h('div', { classe: 'chaleur-col-nom', texte: c })));
    for (const l of lignes) {
      cellules.push(h('div', { classe: 'chaleur-ligne-nom', texte: l }));
      for (const c of colonnes) {
        const d = D.cramer.find(x => x.profil === l && x.consommation === c);
        const cel = h('div', { classe: 'chaleur-cellule ' + classe(d.v), tabindex: '0', role: 'img', 'aria-label': `${l} et ${c} : V = ${nb(d.v, 3)}`, texte: nb(d.v, 2) });
        infobulle(cel, () => [`${l} × ${c}`, `V de Cramér = ${nb(d.v, 3)} ; n = ${nb(d.n, 0)}`]);
        cellules.push(cel);
      }
    }
    el.replaceChildren(...cellules);
    $('#echelle-cramer').replaceChildren(h('span', { texte: 'V faible' }),
      h('span', { classe: 'echelle-degrade' }, [0, 1, 2, 3, 4, 5].map(i => h('i', { classe: 's' + i }))),
      h('span', { texte: 'V ≥ 0,25' }));
  }

  /* -------------------------------------------------------------- profils */
  function profils(D, P, COULEURS) {
    let choisi = D.profils.reduce((a, b) => (b.poids_pct > a.poids_pct ? b : a)).id;
    const ids = D.profils.map(p => p.id);
    const capacite = Math.ceil(Math.max(...D.profils.map(p => p.garde_robe))) + 4;
    const penderie = creerPenderie($('#fiche-penderie'), { capacite, hauteur: 128, graine: 31 });

    const echantillons = D.profils.map(p => h('button', {
      type: 'button', classe: 'echantillon', vars: { '--c': COULEURS[p.id] }, 'aria-pressed': 'false',
      onclick: () => choisir(p.id),
    }, h('b', { texte: p.profil }), h('span', { texte: `${pct(p.poids_pct)} des Français` })));
    $('#echantillons').replaceChildren(...echantillons);

    const dessinerBulles = suivreLargeur($('#graphique-bulles'), largeur => bulles(largeur));
    const dims = [...new Set(D.composition.map(c => c.dimension))];
    let dimension = dims[0], lignesCompo = [];

    function choisir(id, premier = false) {
      const ancien = P[choisi];
      choisi = id;
      const p = P[id];
      echantillons.forEach((b, i) => b.setAttribute('aria-pressed', String(ids[i] === id)));
      $('#fiche-nom').textContent = p.profil;
      $('#fiche-traits').textContent = p.traits;
      const ic = D.bootstrap[id];
      const mesure = (dt, dd, petit) => h('div', {}, h('dt', { texte: dt }), h('dd', {}, dd, petit ? h('small', { texte: petit }) : null));
      $('#fiche-mesures').replaceChildren(
        mesure('Pièces achetées par an', nb(p.flux_moyenne), `de ${nb(p.flux_min)} à ${nb(p.flux_max)} selon les bornes des tranches`),
        mesure('Garde-robe', `${nb(p.garde_robe)} pièces`, `dont ${nb(p.dormant)} qui ne sont plus portées`),
        mesure('Budget annuel', euros(p.budget_mediane), `médiane ; moyenne ${euros(p.budget_moyenne)}`),
        mesure('Part d’occasion', pct(p.pct_occasion), 'des pièces achetées'),
        mesure('Durée de résidence', `${nb(p.duree_ans)} ans`, 'temps moyen d’une pièce dans la garde-robe'),
        mesure('Part de la population', pct(p.poids_pct), `${nb(p.n, 0)} répondants ; achats entre ${nb(ic.flux_ic[0])} et ${nb(ic.flux_ic[1])} (IC 95 %)`));
      penderie.maj({ portees: p.portees, dormantes: Math.round(p.garde_robe) - Math.round(p.portees), colorier: (i, st) => st === 'portee' ? COULEURS[id] : null },
        { animer: !premier, sens: ancien && p.garde_robe < ancien.garde_robe ? -1 : 1 });
      $('#fiche-penderie').setAttribute('aria-label', `Penderie du profil ${p.profil} : ${nb(p.portees)} pièces portées et ${nb(p.dormant)} dormantes.`);
      $('#fiche-penderie-legende').replaceChildren(
        h('span', {}, h('i', { classe: 'pastille', vars: { background: COULEURS[id] } }), `${nb(p.portees)} portées`),
        h('span', {}, h('i', { classe: 'pastille pastille-grise' }), `${nb(p.dormant)} dorment`));
      $('#composition-sous-titre').textContent = `Répartition du profil « ${p.profil} » comparée à l'ensemble des Français.`;
      dessinerBulles();
      majComposition();
    }

    function bulles(largeur) {
      const el = $('#graphique-bulles');
      const H = Math.round(borne(largeur * 0.62, 260, 340)), m = { h: 18, d: 16, b: 40, g: 44 };
      const lp = largeur - m.g - m.d, hp = H - m.h - m.b;
      const xMax = 25, yMin = 40, yMax = 115;
      const x = v => m.g + v / xMax * lp, y = v => m.h + hp - (v - yMin) / (yMax - yMin) * hp;
      const k = Math.min(54, largeur / 11);
      const svg = svgRacine(largeur, H, 'Pièces achetées par an et garde-robe des cinq profils.');
      const grille = s('g', { classe: 'grille' }, svg);
      for (let t = 0; t <= xMax; t += 5) {
        s('line', { x1: x(t), x2: x(t), y1: m.h, y2: m.h + hp }, grille);
        s('text', { x: x(t), y: H - 22, 'text-anchor': 'middle', texte: t }, svg);
      }
      for (let t = 40; t <= 110; t += 20) {
        s('line', { x1: m.g, x2: largeur - m.d, y1: y(t), y2: y(t) }, grille);
        s('text', { x: m.g - 8, y: y(t) + 4, 'text-anchor': 'end', texte: t }, svg);
      }
      s('text', { x: m.g + lp / 2, y: H - 4, 'text-anchor': 'middle', texte: 'pièces achetées par an' }, svg);
      s('text', { x: m.g - 8, y: m.h - 6, 'text-anchor': 'end', texte: 'garde-robe' }, svg);
        for (const p of D.profils) {
        const r = Math.sqrt(p.poids_pct / 100) * k, cx = x(p.flux_moyenne), cy = y(p.garde_robe);
        const g = s('g', { tabindex: '0', role: 'button', 'aria-label': `${p.profil} : ${nb(p.flux_moyenne)} pièces par an, ${nb(p.garde_robe)} en garde-robe`, 'aria-pressed': String(p.id === choisi) }, svg);
        s('circle', { classe: 'bulle', cx, cy, r, remplir: COULEURS[p.id], 'stroke-width': p.id === choisi ? 3 : 2 }, g).style.stroke = p.id === choisi ? 'var(--encre)' : '';
        const ic = D.bootstrap[p.id];
        s('path', { classe: 'ic', d: `M${x(ic.flux_ic[0])},${cy}H${x(ic.flux_ic[1])}M${cx},${y(ic.garde_robe_ic[0])}V${y(ic.garde_robe_ic[1])}` }, g);
        // Les deux premiers profils (les moins acheteurs) ont la place à droite, les autres à gauche.
        const gauche = p.ordre > 2 && cx - r - 8 > m.g + 60;
        s('text', { classe: 'bulle-texte', x: gauche ? cx - r - 7 : cx + r + 7, y: cy + 4, 'text-anchor': gauche ? 'end' : 'start', texte: p.profil }, g);
        g.addEventListener('click', () => choisir(p.id));
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choisir(p.id); } });
        infobulle(g, () => [p.profil, `${nb(p.flux_moyenne)} pièces par an ; ${nb(p.garde_robe)} en garde-robe ; ${pct(p.poids_pct)} des Français`]);
      }
      el.replaceChildren(svg);
    }

    function construireComposition() {
      const donnees = D.composition.filter(c => c.dimension === dimension);
      lignesCompo = donnees.map(c => {
        const piste = h('div', { classe: 'barre-piste compo-piste' },
          h('i', { classe: 'barre-remplie', vars: { '--v': 0 } }), h('i', { classe: 'compo-total', vars: { '--v': 0 } }), h('span', { classe: 'barre-valeur' }));
        infobulle(piste, () => [c.modalite, `${pct(c[choisi])} du profil « ${P[choisi].profil} » ; ${pct(c.total)} de l'ensemble`]);
        return { c, piste, ligne: h('div', { classe: 'barre-ligne' }, h('div', { classe: 'barre-nom', texte: c.modalite }), piste) };
      });
      $('#graphique-composition').replaceChildren(...lignesCompo.map(l => l.ligne));
      prochaineImage(majComposition);
    }
    function majComposition() {
      const donnees = D.composition.filter(c => c.dimension === dimension);
      const max = Math.max(...donnees.flatMap(c => ids.map(id => c[id]).concat(c.total))) * 1.3;
      $('#legende-composition').replaceChildren(
        h('span', {}, h('i', { vars: { '--c': COULEURS[choisi] } }), P[choisi].profil),
        h('span', {}, h('i', { classe: 'trait', vars: { '--c': 'var(--encre-3)' } }), 'Ensemble des Français'));
      lignesCompo.forEach(({ c, piste }) => {
        const [barre, total, valeur] = piste.children;
        barre.style.setProperty('--couleur', COULEURS[choisi]);
        barre.style.setProperty('--v', c[choisi] / max);
        total.style.setProperty('--v', c.total / max);
        valeur.style.setProperty('--fin', Math.max(c[choisi], c.total) / max * 100 + '%');
        valeur.textContent = pct(c[choisi]);
      });
    }
    segments($('#choix-composition'), dims.map(d => [d, d === 'Catégorie socioprofessionnelle' ? 'CSP' : d]), dimension, d => { dimension = d; construireComposition(); });
    construireComposition();
    choisir(choisi, true);

    tableau($('#table-profils'), ['Profil', 'Part (%)', 'n', 'Achats min', 'Achats moyenne', 'Achats max', 'Garde-robe', 'Dormantes', 'Budget médian (€)', 'Occasion (%)', 'Durée (ans)'],
      D.profils.map(p => [p.profil, p.poids_pct, p.n, p.flux_min, p.flux_moyenne, p.flux_max, p.garde_robe, p.dormant, p.budget_mediane, p.pct_occasion, p.duree_ans]));

    // Sensibilité au nombre de groupes
    const fluxMax = Math.max(...D.sensibilite.flatMap(k => k.groupes.map(g => g.flux_moyenne)));
    $('#graphique-sensibilite').replaceChildren(...D.sensibilite.map(k => {
      const retenu = k.K === D.profils.length;
      const barre = h('div', { classe: 'segmentee fine' }, k.groupes.map(g => {
        const etape = 1 + Math.min(4, Math.floor(g.flux_moyenne / fluxMax * 5));
        const seg = h('div', { classe: 's' + etape + (g.poids_pct < 8 ? ' etroit' : ''), vars: { '--part': g.poids_pct }, tabindex: '0' }, h('b', { texte: nb(g.flux_moyenne) }));
        infobulle(seg, () => [`${k.K} groupes`, `un groupe de ${pct(g.poids_pct)} de la population, ${nb(g.flux_moyenne)} pièces achetées par an`]);
        return seg;
      }));
      return h('div', { classe: 'sensibilite-ligne' + (retenu ? ' retenu' : '') },
        h('div', { classe: 'barre-nom' }, h('b', { texte: `${k.K} groupes` + (retenu ? ' (retenu)' : '') }),
          h('span', { texte: `accord avec 5 groupes : ${nb(k.ari_vs_5, 2)}` })), barre);
    }));
  }

  /* ------------------------------------------------------------ scénarios */
  const NOMS_SCENARIOS = { sobre: 'Sobre', median: 'Médian', intensif: 'Intensif', population: 'Ensemble' };
  const COULEURS_SCENARIOS = { sobre: 'var(--seq-2)', median: 'var(--seq-3)', intensif: 'var(--seq-5)' };

  function scenarios(D, pop) {
    const constClimat = D.aesa.categories.find(c => c.cle === 'climat').jours_limite;
    const noms = Object.fromEntries(D.profils.map(p => [p.id, p.profil]));
    const max = 25;
    const p = v => v / max * 100 + '%';
    $('#scenarios').replaceChildren(...D.scenarios.filter(sc => sc.scenario !== 'population').map(sc => {
      const portees = sc.garde_robe - sc.dormant, jours = 365 / portees;
      const ligne = (dt, ...dd) => [h('dt', { texte: dt }), h('dd', {}, ...dd)];
      return h('article', { classe: 'scenario', vars: { '--c': COULEURS_SCENARIOS[sc.scenario] } },
        h('h3', { texte: NOMS_SCENARIOS[sc.scenario] }),
        h('p', { classe: 'part', texte: `${pct(sc.poids_pct)} de la population ; ${sc.profils.map(id => noms[id]).join(' et ')}` }),
        h('dl', {},
          ligne('Pièces achetées par an', `${nb(sc.flux_moyenne)} (de ${nb(sc.flux_min)} à ${nb(sc.flux_max)})`,
            h('div', { classe: 'fourchette', 'aria-hidden': 'true' },
              h('i', { vars: { '--de': p(sc.flux_min), '--l': (sc.flux_max - sc.flux_min) / max * 100 + '%' } }),
              h('u', { vars: { '--x': p(pop.flux) } }),
              h('b', { vars: { '--m': p(sc.flux_moyenne) } }))),
          ligne('Garde-robe', `${nb(sc.garde_robe)} pièces, dont ${nb(sc.dormant)} dormantes`),
          ligne('Durée de résidence d’une pièce', `${nb(sc.duree_ans)} ans`),
          ligne('Port de chaque pièce portée', `≈ ${nb(jours, 0)} jours par an (α = ${nb(jours, 0)}/365)`),
          ligne('Ratio climat de la penderie', `R ≈ ${nb(constClimat / jours, 1)}`),
          ligne('Budget médian ; occasion', `${euros(sc.budget_mediane)} par an ; ${pct(sc.pct_occasion)}`)));
    }));
  }

  /* ----------------------------------------------------- simulateur AESA */
  function simulateur(D, pop) {
    const A = D.aesa;
    const curseurPieces = $('#curseur-pieces'), curseurSimult = $('#curseur-simultanees');
    const etat = { pieces: Math.round(pop.portees * 2) / 2, simultanees: 1, production: A.productions[0].cle };
    const lignes = {};
    const pos = r => (Math.log10(borne(r, 1e-3, 100)) + 3) / 5 * 100;
    const penderie = creerPenderie($('#penderie-aesa'), { capacite: 120, hauteur: 70, graine: 145 });

    const axe = h('div', { classe: 'barre-ligne', 'aria-hidden': 'true' }, h('div', { classe: 'barre-nom' }),
      h('div', { classe: 'axe-graduations' }, [0.001, 0.01, 0.1, 1, 10, 100].map(v =>
        h('span', { classe: v === 1 ? 'limite-texte' : null, vars: { '--x': pos(v) + '%' }, texte: v === 1 ? 'limite' : nb(v, 3) }))),
      h('div', { classe: 'ratio-val', texte: 'R' }));
    $('#graphique-ratios').replaceChildren(axe, ...A.categories.map(c => {
      const piste = h('div', { classe: 'barre-piste ratio-piste' },
        h('i', { classe: 'limite-1', vars: { left: pos(1) + '%' } }),
        h('i', { classe: 'ratio-seg' }), h('b', { classe: 'ratio-point' }));
      const valeur = h('div', { classe: 'ratio-val' });
      infobulle(piste, () => [c.nom, `R = ${nb(lignes[c.cle].r, 3)} (${c.unite}). La catégorie reste dans sa part de l'espace sûr si R ≤ 1.`]);
      lignes[c.cle] = { piste, valeur, r: 0 };
      return h('div', { classe: 'barre-ligne' }, h('div', { classe: 'barre-nom', texte: c.nom }), piste, valeur);
    }));

    function calculer() {
      const facteurs = A.productions.find(pr => pr.cle === etat.production).facteurs;
      const jours = Math.min(365, 365 * etat.simultanees / etat.pieces);
      let pire = null, joursLimite = 0;
      for (const c of A.categories) {
        const k = c.jours_limite * facteurs[c.cle];
        const r = k / jours;
        lignes[c.cle].r = r;
        joursLimite = Math.max(joursLimite, k);
        if (!pire || r > pire.r) pire = { ...c, r };
        const [, seg, point] = lignes[c.cle].piste.children;
        const val = lignes[c.cle].valeur;
        const x = pos(r), x1 = pos(1), depasse = r > 1;
        seg.style.left = Math.min(x, x1) + '%';
        seg.style.width = Math.abs(x - x1) + '%';
        seg.classList.toggle('depasse', depasse);
        point.style.left = x + '%';
        point.classList.toggle('depasse', depasse);
        val.textContent = r < 1e-3 ? '< 0,001' : nb(r, r < 0.1 ? 3 : r < 10 ? 2 : 1);
      }
      const piecesLimite = 365 * etat.simultanees / joursLimite;
      $('#sortie-pieces').textContent = nb(etat.pieces);
      $('#sortie-simultanees').textContent = etat.simultanees === 1 ? '1 (hypothèse de l’article)' : String(etat.simultanees);
      const verdict = $('#verdict-aesa');
      const j = nb(jours, jours < 10 ? 1 : 0);
      const debut = `Avec ${nb(etat.pieces)} pièces portées à tour de rôle, chacune sert ${j} jours par an (α = ${j}/365). `;
      verdict.replaceChildren(debut, pire.r > 1
        ? h('span', {}, `${pire.nom} : `, h('strong', { texte: `R = ${nb(pire.r, pire.r < 10 ? 1 : 0)}` }),
          `, soit ${nb(pire.r, pire.r < 10 ? 1 : 0)} fois la part de l'espace de fonctionnement sûr. Pour revenir sous la limite, il faudrait au plus ${nb(piecesLimite, 1)} pièces portées.`)
        : h('span', {}, h('strong', { texte: 'Toutes les catégories restent sous la limite' }), ` : la penderie compte au plus ${nb(piecesLimite, 1)} pièces portées.`));
      const nLimite = Math.max(1, Math.round(piecesLimite));
      penderie.maj({ portees: etat.pieces, dormantes: 0, colorier: i => (i < nLimite ? 'var(--garance)' : 'var(--trait-fort)') });
      $('#penderie-aesa').setAttribute('aria-label', `${Math.round(etat.pieces)} pièces portées, dont ${nb(piecesLimite, 1)} compatibles avec la limite.`);
      $('#legende-penderie-aesa').textContent = `En rouge, les ${nb(piecesLimite, 1)} pièces qui tiendraient dans la limite climatique ; en gris, le reste des ${nb(etat.pieces)} pièces portées.`;
      remplissageCurseur(curseurPieces);
      remplissageCurseur(curseurSimult);
    }

    const portees = sc => Math.round((sc.garde_robe - sc.dormant) * 2) / 2;
    const choixScenario = segments($('#choix-scenario-aesa'),
      D.scenarios.map(sc => [sc.scenario, NOMS_SCENARIOS[sc.scenario]]), 'population', cle => {
        etat.pieces = portees(D.scenarios.find(sc => sc.scenario === cle));
        curseurPieces.value = etat.pieces;
        calculer();
      });
    segments($('#choix-production'), A.productions.map(pr => [pr.cle, pr.nom]), etat.production, cle => { etat.production = cle; calculer(); });
    curseurPieces.value = etat.pieces;
    curseurSimult.value = etat.simultanees;
    curseurPieces.addEventListener('input', () => {
      etat.pieces = Number(curseurPieces.value);
      const proche = D.scenarios.find(sc => portees(sc) === etat.pieces);
      choixScenario.choisir(proche ? proche.scenario : null);
      calculer();
    });
    curseurSimult.addEventListener('input', () => { etat.simultanees = Number(curseurSimult.value); calculer(); });
    calculer();
  }

  /* ----------------------------------------------------------- et vous ? */
  function etVous(D, P, COULEURS, pop) {
    const champs = ['achats', 'garde-robe', 'budget', 'occasion'].map(n => [n, $('#vous-' + n), $(`#vous-${n}-sortie`)]);
    let fastFashion = false;
    const penderie = creerPenderie($('#penderie-vous'), { capacite: 160, hauteur: 86, graine: 99 });
    const partPortee = pop.portees / pop.garde_robe;
    const climat = D.aesa.categories.find(c => c.cle === 'climat').jours_limite;
    // Échelles : écart P10–P90 / 2,56, soit l'équivalent d'un écart-type pour une loi normale.
    const ind = cle => D.indicateurs.find(i => i.cle === cle);
    const echelle = cle => (ind(cle).p90 - ind(cle).p10) / 2.56;
    const ECH = { flux: echelle('Q25_RT'), garde_robe: echelle('STOCK_COMP'), budget: (Math.log1p(ind('Q24R').p90) - Math.log1p(ind('Q24R').p10)) / 2.56, occasion: 20 };

    function rang(achats) {
      let dessous = 0;
      for (const c of D.distribution) {
        const fin = c.fin ?? c.debut + 2;
        if (achats >= fin) dessous += c.pct;
        else { if (achats > c.debut) dessous += c.pct * (achats - c.debut) / (fin - c.debut); break; }
      }
      return borne(dessous, 0, 100);
    }

    function calculer() {
      const [achats, gr, budget, occasion] = champs.map(([, c]) => Number(c.value));
      champs.forEach(([nom, c, sortie]) => {
        sortie.textContent = nom === 'budget' ? euros(Number(c.value)) : nom === 'occasion' ? pct(Number(c.value), 0) : nb(Number(c.value), 0);
        remplissageCurseur(c);
      });
      let meilleur = null;
      for (const p of D.profils) {
        const d = 1.2 * ((achats - p.flux_moyenne) / ECH.flux) ** 2
          + 0.8 * ((gr - p.garde_robe) / ECH.garde_robe) ** 2
          + ((Math.log1p(budget) - Math.log1p(p.budget_mediane)) / ECH.budget) ** 2
          + ((occasion - p.pct_occasion) / ECH.occasion) ** 2
          + 1.5 * ((fastFashion ? 1 : 0) - (p.cible_question_enseignes ? 1 : 0)) ** 2;
        if (!meilleur || d < meilleur.d) meilleur = { p, d };
      }
      const p = meilleur.p;
      $('#vous-pastille').style.setProperty('--c', COULEURS[p.id]);
      $('#vous-profil').textContent = p.profil;
      $('#vous-explication').textContent = `${p.traits} Ce profil achète en moyenne ${nb(p.flux_moyenne)} pièces par an et en possède ${nb(p.garde_robe)}.`;
      $('#vous-rang').textContent = `${pct(rang(achats), 0)} des Français`;
      const portees = gr * partPortee;
      $('#vous-ratio').textContent = `R ≈ ${nb(climat * portees / 365, 1)}`;
      penderie.maj({ portees: Math.min(160, portees), dormantes: Math.max(0, Math.min(160, gr) - Math.round(Math.min(160, portees))) });
      $('#penderie-vous').setAttribute('aria-label', `Votre penderie : environ ${nb(portees, 0)} pièces portées et ${nb(gr - portees, 0)} dormantes.`);
    }
    champs.forEach(([, c]) => c.addEventListener('input', calculer));
    segments($('#vous-fast-fashion'), [[false, 'Non'], [true, 'Oui']], false, v => { fastFashion = v; calculer(); });
    calculer();
  }

  /* ================================================================= SAS */
  const b64 = texte => Uint8Array.from(atob(texte.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const versB64 = octets => btoa(String.fromCharCode(...new Uint8Array(octets)));

  async function deriverCle(motDePasse, coffre) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(motDePasse.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(coffre.sel), iterations: coffre.iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function ouvrirCoffre(cle, coffre) {
    const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(coffre.iv) }, cle, b64(coffre.chiffre));
    const flux = new Blob([clair]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(flux).text());
  }
  const importerCle = brute => crypto.subtle.importKey('raw', b64(brute), 'AES-GCM', true, ['decrypt']);

  async function afficherContenu(paquet, cle) {
    try { sessionStorage.setItem(CLE_SESSION, versB64(await crypto.subtle.exportKey('raw', cle))); } catch (e) { /* session non mémorisée */ }
    const contenu = $('#contenu');
    contenu.innerHTML = paquet.html;
    $('#sas').remove();
    contenu.hidden = false;
    contenu.classList.add('contenu-entree');
    document.title = 'Consommation textile et AESA';
    demarrer(paquet.donnees);
    if (location.hash.length > 1 && !location.hash.startsWith('#cle=')) {
      const cible = document.getElementById(location.hash.slice(1));
      if (cible) cible.scrollIntoView();
    }
  }

  async function initialiserSas() {
    const coffre = JSON.parse($('#coffre').textContent);
    creerPenderie($('#sas-penderie'), { capacite: 30, hauteur: 86, graine: 12 })
      .maj({ portees: 16, dormantes: 10 });

    const formulaire = $('#sas-formulaire'), champ = $('#mot-de-passe'), bouton = $('#sas-bouton'), message = $('#sas-message');
    if (!window.crypto || !crypto.subtle || !window.DecompressionStream) {
      message.textContent = 'Ce navigateur est trop ancien pour déchiffrer le site. Ouvrez-le avec une version récente de Chrome, Edge, Firefox ou Safari.';
      bouton.disabled = true;
      return;
    }

    // 1. Lien direct : la clé est dans l'ancre (#cle=…), jamais envoyée au serveur.
    const ancre = location.hash.match(/^#cle=([A-Za-z0-9_-]+)/);
    let brute = ancre ? ancre[1] : null;
    if (ancre) history.replaceState(null, '', location.pathname + location.search);
    // 2. Clé gardée pour la durée de l'onglet.
    if (!brute) { try { brute = sessionStorage.getItem(CLE_SESSION); } catch (e) { brute = null; } }
    if (brute) {
      try {
        const cle = await importerCle(brute);
        return afficherContenu(await ouvrirCoffre(cle, coffre), cle);
      } catch (e) {
        try { sessionStorage.removeItem(CLE_SESSION); } catch (_) { /* rien */ }
        if (ancre) message.textContent = 'Le lien direct ne correspond pas à cette version du site. Saisissez le mot de passe.';
      }
    }

    let echecs = 0;
    if (matchMedia('(pointer: fine)').matches) champ.focus({ preventScroll: true });
    formulaire.addEventListener('submit', async e => {
      e.preventDefault();
      if (!champ.value) return;
      bouton.disabled = true;
      message.className = 'sas-message attente';
      message.textContent = 'Déchiffrement…';
      try {
        const cle = await deriverCle(champ.value, coffre);
        const paquet = await ouvrirCoffre(cle, coffre);
        await afficherContenu(paquet, cle);
      } catch (err) {
        echecs += 1;
        // Un délai qui grandit à chaque échec ralentit les essais au hasard.
        await new Promise(r => setTimeout(r, Math.min(4000, 300 * 2 ** (echecs - 1))));
        message.className = 'sas-message';
        message.textContent = 'Mot de passe incorrect. Vérifiez les majuscules et réessayez.';
        bouton.disabled = false;
        champ.select();
        const carte = $('#sas-carte');
        carte.classList.remove('secoue');
        void carte.offsetWidth;
        carte.classList.add('secoue');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialiserSas);
  else initialiserSas();
})();
