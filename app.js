/* Penderie – application du tableau de bord « Consommation textile et AESA ».
   1. Le sas déchiffre le contenu (PBKDF2 + AES-GCM avec Web Crypto, rien n'est envoyé).
   2. Une page par thème, choisie par l'ancre de l'adresse (#achats, #profils…).
   3. Graphiques dessinés à la main : SVG pour les courbes, barres HTML animées par transform.
   Ce fichier ne contient aucun résultat : les chiffres arrivent dans le paquet chiffré. */
'use strict';

// Le site ne doit pas être affiché dans un cadre d'un autre site (protection contre le « clickjacking »).
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  try { window.top.location = window.self.location.href; } catch (e) { /* navigation bloquée : la page reste masquée */ }
}

(() => {
  const $ = (sel, racine = document) => racine.querySelector(sel);
  const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];
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
  function nb(v, dec = 1, fixe = false) {
    const cle = dec + (fixe ? 'f' : '');
    const f = formats[cle] || (formats[cle] = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: dec, minimumFractionDigits: fixe ? dec : 0 }));
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
  const svgRacine = (l, ht, etiquette) => s('svg', { viewBox: `0 0 ${l} ${ht}`, width: l, height: ht, role: 'img', 'aria-label': etiquette });
  function ico(nom, classe = 'ico') {
    const el = s('svg', { classe, 'aria-hidden': 'true', focusable: 'false' });
    s('use', { href: '#i-' + nom }, el);
    return el;
  }

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
    return { choisir(val) { boutons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === val))); } };
  }

  function remplissageCurseur(curseur) {
    const p = (curseur.value - curseur.min) / (curseur.max - curseur.min) * 100;
    curseur.style.setProperty('--pct', p + '%');
  }

  // Redessine un graphique quand la largeur de son conteneur change (y compris quand sa page s'affiche).
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
    // Le premier dessin note sa largeur : l'observateur ne redessine pas aussitôt (ce qui couperait une animation).
    return () => {
      const largeur = Math.round(el.getBoundingClientRect().width);
      if (largeur) { d.largeur = largeur; dessiner(largeur); }
      return largeur > 0;
    };
  }

  function tableau(details, entetes, lignes) {
    const numerique = entetes.map((_, j) => lignes.every(l => typeof l[j] === 'number'));
    const table = h('table', {},
      h('thead', {}, h('tr', {}, entetes.map((e, j) => h('th', { classe: numerique[j] ? 'n' : null, scope: 'col', texte: e })))),
      h('tbody', {}, lignes.map(l => h('tr', {}, l.map((v, j) => h('td', { classe: numerique[j] ? 'n' : null, texte: typeof v === 'number' ? nb(v, 2) : v }))))));
    details.append(h('div', { classe: 'tableau-defile' }, table));
  }

  /* -------------------------------------------------- compteurs animés */
  // Un nombre écrit en français (« 3,5 », « 10 % », « 1 000 ») monte de 0 à sa valeur.
  function compter(el, duree = 1000) {
    const original = el.dataset.texte || (el.dataset.texte = el.textContent);
    const m = original.match(/^(\D*?)([\d   ]+(?:,\d+)?)(.*)$/s);
    if (!m || mouvementReduit()) { el.textContent = original; return; }
    const cible = parseFloat(m[2].replace(/[\s  ]/g, '').replace(',', '.'));
    const dec = (m[2].split(',')[1] || '').length;
    const jeton = (el._jeton = (el._jeton || 0) + 1);
    const debut = performance.now();
    const pas = t => {
      if (el._jeton !== jeton) return;
      const x = Math.min(1, (t - debut) / duree);
      const e = x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
      el.textContent = x === 1 ? original : m[1] + nb(cible * e, dec, true) + m[3];
      if (x < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
  }

  /* ---------------------------------------------------- bulles « Comment lire » */
  function bullesInfo() {
    const fenetre = $('#bulle-info');
    let ouvert = null;
    const fermer = () => {
      if (!ouvert) return;
      ouvert.setAttribute('aria-expanded', 'false');
      ouvert = null;
      fenetre.hidden = true;
    };
    const ouvrir = bouton => {
      fermer();
      ouvert = bouton;
      bouton.setAttribute('aria-expanded', 'true');
      fenetre.replaceChildren(h('b', { texte: 'Comment lire' }), bouton.dataset.info);
      fenetre.hidden = false;
      const r = bouton.getBoundingClientRect(), f = fenetre.getBoundingClientRect();
      fenetre.style.left = borne(r.right - f.width, 8, innerWidth - f.width - 8) + 'px';
      fenetre.style.top = (r.bottom + 8 + f.height > innerHeight ? r.top - f.height - 8 : r.bottom + 8) + 'px';
    };
    document.addEventListener('click', e => {
      const bouton = e.target.closest('.bouton-info');
      if (bouton) { e.preventDefault(); return ouvert === bouton ? fermer() : ouvrir(bouton); }
      if (ouvert && !fenetre.contains(e.target)) fermer();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { const b = ouvert; fermer(); if (b) b.focus(); } });
    addEventListener('scroll', fermer, { passive: true });
    return fermer;
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
        g.style.setProperty('--retard', Math.max(0, sens > 0 ? i : total - i) * pasRetard + 'ms');
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
        s('text', { classe: 'note', x: ancre === 'start' ? x0 : x1, y: y + 28, 'text-anchor': ancre, texte }, groupeNotes);
      };
      accolade(0, np * pas, notes.portees(etat), 'start');
      accolade(np * pas, total * pas, notes.dormantes(etat), 'end');
    }

    const depart = suivreLargeur(conteneur, construire);
    depart();
    return {
      maj(nouvel, { animer = false, sens = 1 } = {}) {
        etat = { ...etat, ...nouvel };
        // Penderie d'une page encore jamais affichée : on la construit maintenant, vide, puis on l'anime.
        if (!pieces.length && depart()) void conteneur.offsetWidth;
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
  const VUES = ['apercu', 'achats', 'garde-robe', 'facteurs', 'profils', 'impact', 'vous', 'methode'];
  const TITRES = { apercu: 'Aperçu', achats: 'Achats', 'garde-robe': 'Garde-robe', facteurs: 'Facteurs', profils: 'Profils', impact: 'Impact', vous: 'Et vous ?', methode: 'Méthode' };
  const premieresVisites = {};

  function demarrer(D) {
    // Une couleur par profil, dans l'ordre des profils (palette validée pour les daltoniens).
    const COULEURS = Object.fromEntries(D.profils.map((p, i) => [p.id, `var(--p${i + 1})`]));
    const P = Object.fromEntries(D.profils.map(p => [p.id, p]));
    const indicateur = cle => D.indicateurs.find(i => i.cle === cle);
    const flux = indicateur('Q25_RT');
    const pop = {
      flux: flux.moyenne, garde_robe: indicateur('STOCK_COMP').moyenne,
      portees: indicateur('TOT_PORT').moyenne, dormant: indicateur('TOT_STOCK').moyenne,
    };
    const climat = D.aesa.categories.find(c => c.cle === 'climat').jours_limite;

    coquille();
    apercu(D, pop, flux, COULEURS);
    distribution(D, flux);
    concentration(D);
    intervalles(D, 'flux', $('#intervalles-flux'));
    intervalles(D, 'garde_robe', $('#intervalles-garde-robe'));
    groupes(D, pop, 'flux', $('#dimensions-achats'), $('#groupes-achats'));
    groupes(D, pop, 'garde_robe', $('#dimensions-garde-robe'), $('#groupes-garde-robe'));
    gardeRobe(pop);
    foret(D);
    spearman(D);
    cramer(D);
    profils(D, P, COULEURS);
    impact(D, pop, climat);
    simulateur(D, pop);
    etVous(D, COULEURS, pop, climat);
    methode(D);
    routeur();
  }

  /* --------------------------------------------- navigation entre les pages */
  function routeur() {
    const fermerInfo = bullesInfo();
    const plus = $('#bouton-plus'), feuille = $('#feuille');
    const fermerFeuille = () => { feuille.hidden = true; plus.setAttribute('aria-expanded', 'false'); };
    plus.addEventListener('click', e => {
      e.stopPropagation();
      const ouvrir = feuille.hidden;
      feuille.hidden = !ouvrir;
      plus.setAttribute('aria-expanded', String(ouvrir));
    });
    document.addEventListener('click', e => { if (!feuille.hidden && !feuille.contains(e.target)) fermerFeuille(); });

    const cible = () => {
      const ancre = decodeURIComponent(location.hash.slice(1));
      if (VUES.includes(ancre)) return { vue: ancre };
      const el = ancre && document.getElementById(ancre);
      const section = el && el.closest('.vue');
      return section ? { vue: section.dataset.vue, el } : { vue: 'apercu' };
    };

    function afficher() {
      const { vue, el } = cible();
      const section = document.querySelector(`.vue[data-vue="${vue}"]`);
      $$('.vue').forEach(v => { v.hidden = v !== section; });
      $$('[data-lien]').forEach(a => (a.dataset.lien === vue ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
      plus.classList.toggle('actif', !!feuille.querySelector(`[data-lien="${vue}"]`));
      fermerFeuille();
      fermerInfo();
      masquerBulle();
      document.title = `${TITRES[vue]} – Penderie`;

      section.classList.remove('entree', 'retour');
      void section.offsetWidth;
      const premiere = !section.dataset.vue_vue;
      if (premiere) {
        section.dataset.vue_vue = '1';
        echelonner(section);
        section.classList.add('entree');
        $$('.compte', section).forEach((c, i) => compter(c, i ? 800 : 1100));
        (premieresVisites[vue] || []).forEach(f => f());
      } else {
        section.classList.add('retour');
      }
      if (el) el.scrollIntoView({ behavior: mouvementReduit() ? 'auto' : 'smooth', block: 'start' });
      else window.scrollTo(0, 0);
    }
    addEventListener('hashchange', afficher);
    afficher();
  }

  // La carte principale mène et monte le plus ; les suivantes suivent avec des écarts qui raccourcissent.
  function echelonner(section) {
    let delai = 0;
    $$('.carte, .choix-profil', section).forEach((carte, i) => {
      if (i > 0) delai += Math.max(10, 46 - i * 5);
      carte.style.setProperty('--delai', Math.min(delai, 280) + 'ms');
      carte.style.setProperty('--distance', (i === 0 ? 14 : i < 4 ? 8 : 5) + 'px');
    });
  }
  const quandPremiereVisite = (vue, f) => (premieresVisites[vue] = premieresVisites[vue] || []).push(f);

  function coquille() {
    const boutonTheme = $('#bouton-theme');
    const themeActuel = () => racine.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const libelle = () => {
      const sombre = themeActuel() === 'dark';
      boutonTheme.setAttribute('aria-label', sombre ? 'Passer en thème clair' : 'Passer en thème sombre');
      boutonTheme.querySelector('use').setAttribute('href', sombre ? '#i-soleil' : '#i-lune');
    };
    libelle();
    boutonTheme.addEventListener('click', () => {
      const t = themeActuel() === 'dark' ? 'light' : 'dark';
      const appliquer = () => {
        racine.dataset.theme = t;
        try { localStorage.setItem('theme', t); } catch (e) { /* sans importance */ }
        libelle();
      };
      if (!document.startViewTransition || mouvementReduit()) return appliquer();
      // Le nouveau thème s'ouvre en cercle depuis le bouton.
      const r = boutonTheme.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const rayon = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      document.startViewTransition(appliquer).ready.then(() => {
        racine.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${rayon}px at ${x}px ${y}px)`] },
          { duration: 560, easing: 'cubic-bezier(.2, .8, .2, 1)', pseudoElement: '::view-transition-new(root)' });
      });
    });
    $('#bouton-verrou').addEventListener('click', () => {
      try { sessionStorage.removeItem(CLE_SESSION); } catch (e) { /* rien à effacer */ }
      location.replace(location.pathname);
    });
    loupe($('.rail'), { horizontal: false, portee: 78, gain: .42, decalage: 9 });
    loupe($('.nav-pilule'), { horizontal: true, portee: 130, gain: .22 });
  }

  /* ------------------------------------- effet loupe sur les deux barres de navigation */
  // Ressort amorti sans rebond (réponse en secondes) : il repart toujours de sa position actuelle,
  // donc la souris peut changer de direction à tout moment sans à-coup.
  function ressort(reponse = .22) {
    const k = (2 * Math.PI / reponse) ** 2, c = 4 * Math.PI / reponse;
    return {
      x: 0, v: 0, cible: 0,
      pas(dt) {
        for (let i = 0; i < 4; i++) { this.v += (-k * (this.x - this.cible) - c * this.v) * dt / 4; this.x += this.v * dt / 4; }
        if (Math.abs(this.x - this.cible) < .002 && Math.abs(this.v) < .02) { this.x = this.cible; this.v = 0; return false; }
        return true;
      },
    };
  }

  // Comme le Dock du Mac : ce qui est près de la souris grossit.
  // Rail : les icônes grossissent et sortent un peu vers la droite.
  // Barre du haut : les mots grossis s'écartent, le point sous la souris reste sous la souris,
  // et le fond de la pilule s'allonge des deux côtés pour les contenir.
  function loupe(nav, { horizontal, portee, gain, decalage = 0 }) {
    const liens = $$('a', nav);
    const forces = liens.map(() => ressort());
    let mesures = [], q = 0, actif = false, image = 0, dernier = 0;

    // Positions au repos (offsetLeft / offsetTop ignorent les transformations en cours).
    const mesurer = () => {
      mesures = liens.map(l => (horizontal ? { debut: l.offsetLeft, taille: l.offsetWidth } : { debut: l.offsetTop, taille: l.offsetHeight }));
    };

    function dessiner() {
      const t = forces.map(f => f.x);
      if (horizontal) {
        const ajouts = mesures.map((m, i) => m.taille * gain * t[i]);
        let k = mesures.findIndex(m => q < m.debut + m.taille);
        if (k < 0) k = mesures.length - 1;
        let ancrage = borne((q - mesures[k].debut) / mesures[k].taille, 0, 1) * ajouts[k];
        for (let i = 0; i < k; i++) ancrage += ajouts[i];
        let cumul = 0;
        liens.forEach((l, i) => {
          const dx = cumul + ajouts[i] / 2 - ancrage;
          cumul += ajouts[i];
          l.style.transform = t[i] > .001 || Math.abs(dx) > .05 ? `translate3d(${dx.toFixed(2)}px,0,0) scale(${(1 + gain * t[i]).toFixed(4)})` : '';
          l.classList.toggle('devant', t[i] > .4);
        });
        nav.style.setProperty('--g', ancrage.toFixed(2) + 'px');
        nav.style.setProperty('--d', (cumul - ancrage).toFixed(2) + 'px');
      } else {
        liens.forEach((l, i) => {
          l.style.transform = t[i] > .001 ? `translate3d(${(decalage * t[i]).toFixed(2)}px,0,0) scale(${(1 + gain * t[i]).toFixed(4)})` : '';
          l.style.setProperty('--s', (1 + gain * t[i]).toFixed(4));
          l.classList.toggle('devant', t[i] > .4);
        });
      }
    }
    function tic(maintenant) {
      const dt = Math.min((maintenant - dernier) / 1000, 1 / 30);
      dernier = maintenant;
      let encore = false;
      forces.forEach(f => { encore = f.pas(dt) || encore; });
      dessiner();
      image = encore ? requestAnimationFrame(tic) : 0;
    }
    const lancer = () => { if (!image) { dernier = performance.now(); image = requestAnimationFrame(tic); } };

    nav.addEventListener('pointerenter', e => {
      // Pas au doigt, pas si l'utilisateur a demandé moins d'animations, pas quand la pilule défile (écran étroit).
      actif = e.pointerType !== 'touch' && !mouvementReduit() && (!horizontal || getComputedStyle(nav).overflowX === 'visible');
      if (actif) mesurer();
    });
    nav.addEventListener('pointermove', e => {
      if (!actif) return;
      const r = nav.getBoundingClientRect();
      q = horizontal ? e.clientX - r.left - nav.clientLeft : e.clientY - r.top - nav.clientTop;
      let proche = null, ecart = Infinity;
      mesures.forEach((m, i) => {
        const d = Math.abs(m.debut + m.taille / 2 - q);
        const u = Math.max(0, 1 - d / portee);
        forces[i].cible = u * u * (3 - 2 * u);
        if (d < ecart) { ecart = d; proche = liens[i]; }
      });
      liens.forEach(l => l.classList.toggle('proche', l === proche));
      lancer();
    });
    nav.addEventListener('pointerleave', () => {
      if (!actif) return;
      forces.forEach(f => { f.cible = 0; });
      liens.forEach(l => l.classList.remove('proche'));
      lancer();
    });
  }

  /* -------------------------------------------------------------- aperçu */
  function apercu(D, pop, flux, COULEURS) {
    const max = Math.max(...D.distribution.map(c => c.pct));
    $('#mini-histo').replaceChildren(...D.distribution.map((c, i) => h('i', {
      classe: c.debut <= flux.mediane && flux.mediane < (c.fin ?? Infinity) ? 'mediane' : null,
      vars: { '--h': c.pct / max * 100 + '%', '--i': i },
    })));
    $('#jauge-apercu > i').style.setProperty('--v', pop.portees / pop.garde_robe);

    $('#reperes').replaceChildren(...D.reperes.map(r => h('li', {},
      h('span', { classe: 'pastille-ico' }, ico(r.icone)),
      h('div', {}, h('b', { texte: r.libelle }), h('small', { texte: r.detail })),
      h('span', { classe: 'val', texte: r.valeur }))));

    $('#barre-profils').replaceChildren(...D.profils.map((p, i) => h('i', { vars: { '--part': p.poids_pct, '--c': COULEURS[p.id], '--i': i } }, ico(p.icone))));
    $('#legende-profils').replaceChildren(...D.profils.map(p => h('span', {}, h('i', { vars: { '--c': COULEURS[p.id] } }), p.profil, h('b', { texte: pct(p.poids_pct) }))));

    const penderie = creerPenderie($('#penderie-apercu'), {
      capacite: Math.ceil(pop.garde_robe) + 6, hauteur: 205, graine: 2024,
      notes: { portees: () => `${nb(pop.portees)} portées couramment`, dormantes: () => `${nb(pop.dormant)} ne sont plus portées` },
    });
    const total = Math.round(pop.garde_robe);
    // Un seul moment chorégraphié : les pièces se suspendent, puis la moitié s'éteint.
    quandPremiereVisite('apercu', () => prochaineImage(() => {
      penderie.maj({ portees: total, dormantes: 0 }, { animer: true });
      apres(1150, () => {
        penderie.maj({ portees: pop.portees, dormantes: total - Math.round(pop.portees) }, { animer: true, sens: -1 });
        apres(700, () => penderie.montrerNotes());
      });
    }));
  }

  function gardeRobe(pop) {
    $('#jauge-garde-robe > i').style.setProperty('--v', pop.portees / pop.garde_robe);
    const penderie = creerPenderie($('#penderie-garde-robe'), { capacite: Math.ceil(pop.garde_robe) + 4, hauteur: 130, graine: 78 });
    quandPremiereVisite('garde-robe', () => prochaineImage(() =>
      penderie.maj({ portees: pop.portees, dormantes: Math.round(pop.garde_robe) - Math.round(pop.portees) }, { animer: true })));
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
      const H = 180, m = { h: 8, d: 10, b: 26, g: 36 };
      const lp = largeur - m.g - m.d, hp = H - m.h - m.b;
      const x = v => m.g + v / 100 * lp, y = v => m.h + hp - v / 100 * hp;
      const svg = svgRacine(largeur, H, `Courbe de concentration : les 10 % plus gros acheteurs réalisent ${pct(pts[1].y)} des achats.`);
      const grille = s('g', { classe: 'grille' }, svg);
      [0, 50, 100].forEach(t => {
        s('line', { x1: m.g, x2: largeur - m.d, y1: y(t), y2: y(t) }, grille);
        s('text', { x: m.g - 6, y: y(t) + 4, 'text-anchor': 'end', texte: t + ESP + '%' }, svg);
        s('text', { x: x(t), y: H - 6, 'text-anchor': t === 0 ? 'start' : t === 100 ? 'end' : 'middle', texte: t + ESP + '%' }, svg);
      });
      s('line', { classe: 'egalite', x1: x(0), y1: y(0), x2: x(100), y2: y(100) }, svg);
      const chemin = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x)},${y(p.y)}`).join('');
      s('path', { classe: 'aire', d: `${chemin}L${x(100)},${y(0)}Z` }, svg);
      s('path', { classe: 'ligne', d: chemin }, svg);
      pts.slice(1, -1).forEach(p => {
        const point = s('circle', { classe: 'point', cx: x(p.x), cy: y(p.y), r: 4.5, remplir: 'var(--p1)' }, svg);
        const zone = s('circle', { classe: 'zone-survol', cx: x(p.x), cy: y(p.y), r: 15, tabindex: '0' }, svg);
        zone.addEventListener('pointerenter', () => point.setAttribute('r', 6.5));
        zone.addEventListener('pointerleave', () => point.setAttribute('r', 4.5));
        infobulle(zone, () => [`Les ${p.x}${ESP}% plus gros acheteurs`, `réalisent ${pct(p.y)} des achats de vêtements`]);
      });
      el.replaceChildren(svg);
    };
    suivreLargeur(el, dessiner)();
  }

  /* ------------------------------------------------- intervalles min / max */
  function intervalles(D, grandeur, el) {
    const donnees = D.intervalles.filter(r => r.id.startsWith(grandeur + '_'));
    const max = Math.ceil(Math.max(...donnees.map(r => r.haute)) * 1.3 / 10) * 10;
    const p = v => v / max * 100 + '%';
    const lignes = donnees.map(r => {
      const piste = h('div', { classe: 'barre-piste fourchette-piste' },
        h('i', { classe: 'fourchette-seg', vars: { '--de': p(r.basse), '--l': (r.haute - r.basse) / max * 100 + '%' } }),
        h('b', { classe: 'fourchette-pt', vars: { '--x': p(r.centre) } }),
        h('span', { classe: 'fourchette-val', vars: { '--x': p(r.haute) }, texte: r.basse === r.haute ? nb(r.centre) : `${nb(r.basse)} à ${nb(r.haute)}` }));
      infobulle(piste, () => [`${r.grandeur} : ${r.statistique.toLowerCase()}`, `estimation basse ${nb(r.basse)}, centre ${nb(r.centre)}, haute ${nb(r.haute)} pièces`]);
      return h('div', { classe: 'barre-ligne' }, h('div', { classe: 'barre-nom', texte: r.statistique.replace(/ \(.*\)/, '') }), piste);
    });
    const pasAxe = max <= 40 ? 10 : max <= 100 ? 25 : 50;
    const graduations = [];
    for (let t = 0; t <= max; t += pasAxe) graduations.push(h('span', { vars: { '--x': p(t) }, texte: nb(t, 0) }));
    el.replaceChildren(...lignes, h('div', { classe: 'barre-ligne axe-ligne', 'aria-hidden': 'true' }, h('div'), h('div', { classe: 'axe-graduations' }, graduations)));
  }

  /* ----------------------------------------------------------- groupes */
  function groupes(D, pop, mesure, choix, el) {
    const dimensions = [...new Set(D.groupes.map(g => g.dimension))];
    const cleMoy = mesure + '_moyenne', cleMed = mesure + '_mediane';
    const max = Math.max(...D.groupes.map(g => g[cleMoy])) * 1.2;
    const reference = mesure === 'flux' ? pop.flux : pop.garde_robe;
    function afficher(dimension, animer) {
      const lignes = D.groupes.filter(g => g.dimension === dimension).map(g => {
        const piste = h('div', { classe: 'barre-piste' },
          h('i', { classe: 'barre-remplie', vars: { '--v': animer ? 0 : g[cleMoy] / max } }),
          h('i', { classe: 'barre-repere', vars: { '--x': g[cleMed] / max * 100 + '%' } }),
          h('i', { classe: 'barre-ref', vars: { '--x': reference / max * 100 + '%' } }),
          h('span', { classe: 'barre-valeur', vars: { '--fin': g[cleMoy] / max * 100 + '%' }, texte: nb(g[cleMoy]) }));
        infobulle(piste, () => [g.modalite, `moyenne ${nb(g[cleMoy])}, médiane ${nb(g[cleMed])} pièces ; ${pct(g.poids_pct)} de la population (n = ${nb(g.n, 0)})`]);
        return h('div', { classe: 'barre-ligne' }, h('div', { classe: 'barre-nom', texte: g.modalite }), piste);
      });
      el.replaceChildren(...lignes);
      if (animer) prochaineImage(() => lignes.forEach((l, i) => {
        const g = D.groupes.filter(x => x.dimension === dimension)[i];
        l.querySelector('.barre-remplie').style.setProperty('--v', g[cleMoy] / max);
      }));
    }
    segments(choix, dimensions.map(d => [d, d]), dimensions[0], d => afficher(d, true));
    afficher(dimensions[0], false);
  }

  /* ------------------------------------------------- effets (régression) */
  function foret(D) {
    const el = $('#graphique-foret');
    $('#legende-foret').replaceChildren(
      h('span', {}, h('i', { classe: 'rond plein' }), 'écart net'),
      h('span', {}, h('i', { classe: 'rond' }), 'écart incertain (l\'intervalle croise 0)'));
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
      h('span', {}, h('i', { vars: { '--c': 'var(--p2)' } }), 'en sens contraire'));
    const lignes = [...D.spearman].sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho)).slice(0, 12).map(c => {
      const positif = c.rho >= 0;
      const piste = h('div', { classe: 'barre-piste spearman-piste' },
        h('i', { classe: 'ecart-zero', vars: { '--x': '50%' } }),
        h('i', { classe: 'sp-barre ' + (positif ? 'positive' : 'negative'), vars: { '--de': (positif ? 50 : pos(c.rho)) + '%', '--l': Math.abs(c.rho) / (2 * lim) * 100 + '%' } }),
        h('span', { classe: 'sp-val ' + (positif ? 'droite' : 'gauche'), vars: { '--x': pos(c.rho) + '%' }, texte: signe(c.rho, 2) }));
      infobulle(piste, () => [`${c.var_a} et ${c.var_b}`, `ρ = ${nb(c.rho, 3)} ; n = ${nb(c.n, 0)}`]);
      return h('div', { classe: 'barre-ligne' }, h('div', { classe: 'barre-nom', texte: `${c.var_a} ↔ ${c.var_b}` }), piste);
    });
    el.replaceChildren(...lignes);
  }

  /* ---------------------------------------------------------- V de Cramér */
  function cramer(D) {
    const el = $('#graphique-cramer');
    const lignes = [...new Set(D.cramer.map(c => c.profil))];
    const colonnes = [...new Set(D.cramer.map(c => c.consommation))];
    const seuils = [0.05, 0.1, 0.15, 0.2, 0.25];
    const classe = v => 's' + seuils.filter(t => v >= t).length;
    el.style.gridTemplateColumns = `minmax(130px, 1.6fr) repeat(${colonnes.length}, minmax(64px, 1fr))`;
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
    const penderie = creerPenderie($('#penderie-profil'), { capacite, hauteur: 110, graine: 31 });
    const heros = $('#heros-profil');

    const boutons = D.profils.map(p => h('button', {
      type: 'button', classe: 'choix-profil', vars: { '--c': COULEURS[p.id] }, 'aria-pressed': 'false', onclick: () => choisir(p.id),
    }, h('span', { classe: 'pastille-ico' }, ico(p.icone)),
    h('div', {}, h('b', { texte: p.profil }), h('span', { texte: `${pct(p.poids_pct)} des Français` })),
    h('div', { classe: 'mini-flux' }, nb(p.flux_moyenne), h('small', { texte: ' pièces / an' }))));
    $('#choix-profils').replaceChildren(...boutons);

    const dessinerBulles = suivreLargeur($('#graphique-bulles'), bulles);
    const dims = [...new Set(D.composition.map(c => c.dimension))];
    let dimension = dims[0], lignesCompo = [];

    function choisir(id, premier = false) {
      const ancien = P[choisi];
      choisi = id;
      const p = P[id], rang = ids.indexOf(id) + 1, ic = D.bootstrap[id];
      boutons.forEach((b, i) => b.setAttribute('aria-pressed', String(ids[i] === id)));
      heros.style.setProperty('--c', COULEURS[id]);
      $('#profil-badge').replaceChildren(ico(p.icone), `Profil ${rang} sur ${D.profils.length}`);
      $('#profil-part').textContent = `${pct(p.poids_pct)} des Français, n = ${nb(p.n, 0)}`;
      $('#profil-nom').textContent = p.profil;
      $('#profil-traits').textContent = p.traits;
      const mesure = (dt, valeur, petit) => h('div', {}, h('dt', { texte: dt }), h('dd', {}, h('span', { classe: 'compte', texte: valeur }), petit ? h('small', { texte: petit }) : null));
      $('#profil-mesures').replaceChildren(
        mesure('Achats par an', nb(p.flux_moyenne), `de ${nb(p.flux_min)} à ${nb(p.flux_max)} ; IC ${nb(ic.flux_ic[0])}–${nb(ic.flux_ic[1])}`),
        mesure('Garde-robe', nb(p.garde_robe), `dont ${nb(p.dormant)} qui dorment`),
        mesure('Budget médian', euros(p.budget_mediane), `moyenne ${euros(p.budget_moyenne)}`),
        mesure('Occasion', pct(p.pct_occasion), `résidence ${nb(p.duree_ans)} ans`));
      if (!premier) $$('#profil-mesures .compte').forEach(c => compter(c, 600));
      penderie.maj({ portees: p.portees, dormantes: Math.round(p.garde_robe) - Math.round(p.portees), colorier: (i, st) => (st === 'portee' ? '#fff' : null) },
        { animer: !premier, sens: ancien && p.garde_robe < ancien.garde_robe ? -1 : 1 });
      $('#penderie-profil').setAttribute('aria-label', `Penderie du profil ${p.profil} : ${nb(p.portees)} pièces portées et ${nb(p.dormant)} dormantes.`);
      $('#penderie-profil-legende').replaceChildren(
        h('span', {}, h('i', { classe: 'pastille', vars: { background: '#fff' } }), `${nb(p.portees)} portées`),
        h('span', {}, h('i', { classe: 'pastille', vars: { background: 'rgba(255,255,255,.3)' } }), `${nb(p.dormant)} dorment`));
      $('#composition-sous-titre').textContent = `« ${p.profil} » comparé à l'ensemble`;
      dessinerBulles();
      majComposition();
    }

    function bulles(largeur) {
      const el = $('#graphique-bulles');
      const H = Math.round(borne(largeur * 0.62, 240, 320)), m = { h: 18, d: 16, b: 40, g: 44 };
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
      s('text', { x: m.g, y: m.h - 6, texte: 'garde-robe' }, svg);
      for (const p of D.profils) {
        const r = Math.sqrt(p.poids_pct / 100) * k, cx = x(p.flux_moyenne), cy = y(p.garde_robe);
        const g = s('g', { tabindex: '0', role: 'button', 'aria-label': `${p.profil} : ${nb(p.flux_moyenne)} pièces par an, ${nb(p.garde_robe)} en garde-robe`, 'aria-pressed': String(p.id === choisi) }, svg);
        const cercle = s('circle', { classe: 'bulle', cx, cy, r, remplir: COULEURS[p.id], 'stroke-width': p.id === choisi ? 3 : 2 }, g);
        if (p.id === choisi) cercle.style.stroke = 'var(--encre)';
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
      lignesCompo = D.composition.filter(c => c.dimension === dimension).map(c => {
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
        h('span', {}, h('i', { classe: 'trait', vars: { '--c': 'var(--encre-3)' } }), 'Ensemble'));
      lignesCompo.forEach(({ c, piste }) => {
        const [barre, total, valeur] = piste.children;
        barre.style.setProperty('--couleur', COULEURS[choisi]);
        barre.style.setProperty('--v', c[choisi] / max);
        total.style.setProperty('--v', c.total / max);
        valeur.style.setProperty('--fin', Math.max(c[choisi], c.total) / max * 100 + '%');
        valeur.textContent = pct(c[choisi]);
      });
    }
    segments($('#choix-composition'), dims.map(d => [d, d === 'Catégorie socioprofessionnelle' ? 'CSP' : d === 'Taille de la commune' ? 'Commune' : d]), dimension,
      d => { dimension = d; construireComposition(); });
    construireComposition();
    choisir(choisi, true);

    tableau($('#table-profils'), ['Profil', 'Part (%)', 'n', 'Achats min', 'Achats moyenne', 'Achats max', 'Garde-robe', 'Dormantes', 'Budget médian (€)', 'Occasion (%)', 'Durée (ans)'],
      D.profils.map(p => [p.profil, p.poids_pct, p.n, p.flux_min, p.flux_moyenne, p.flux_max, p.garde_robe, p.dormant, p.budget_mediane, p.pct_occasion, p.duree_ans]));

    const fluxMax = Math.max(...D.sensibilite.flatMap(k => k.groupes.map(g => g.flux_moyenne)));
    $('#graphique-sensibilite').replaceChildren(...D.sensibilite.map(k => {
      const retenu = k.K === D.profils.length;
      const barre = h('div', { classe: 'segmentee' }, k.groupes.map(g => {
        const etape = 1 + Math.min(4, Math.floor(g.flux_moyenne / fluxMax * 5));
        const seg = h('div', { classe: 's' + etape + (g.poids_pct < 8 ? ' etroit' : ''), vars: { '--part': g.poids_pct }, tabindex: '0' }, h('b', { texte: nb(g.flux_moyenne) }));
        infobulle(seg, () => [`${k.K} groupes`, `un groupe de ${pct(g.poids_pct)} de la population, ${nb(g.flux_moyenne)} pièces achetées par an`]);
        return seg;
      }));
      return h('div', { classe: 'sensibilite-ligne' + (retenu ? ' retenu' : '') },
        h('div', { classe: 'barre-nom' }, h('b', { texte: `${k.K} groupes` + (retenu ? ' (retenu)' : '') }), h('span', { texte: `accord : ${nb(k.ari_vs_5, 2)}` })), barre);
    }));
  }

  /* --------------------------------------------------------------- impact */
  const NOMS_SCENARIOS = { sobre: 'Sobre', median: 'Médian', intensif: 'Intensif', population: 'Ensemble' };
  const COULEURS_SCENARIOS = { sobre: 'var(--p3)', median: 'var(--p1)', intensif: 'var(--garance)' };

  function impact(D, pop, climat) {
    const piecesLimite = 365 / climat;
    const penderie = creerPenderie($('#penderie-impact'), { capacite: Math.ceil(pop.portees) + 3, hauteur: 92, graine: 145 });
    quandPremiereVisite('impact', () => prochaineImage(() => penderie.maj(
      { portees: pop.portees, dormantes: 0, colorier: i => (i < Math.round(piecesLimite) ? '#fff' : 'rgba(255,255,255,.28)') }, { animer: true })));

    const noms = Object.fromEntries(D.profils.map(p => [p.id, p.profil]));
    const p = v => v / 25 * 100 + '%';
    $('#scenarios').replaceChildren(...D.scenarios.filter(sc => sc.scenario !== 'population').map(sc => {
      const portees = sc.garde_robe - sc.dormant, jours = 365 / portees;
      const ligne = (dt, dd) => h('div', {}, h('dt', { texte: dt }), h('dd', { texte: dd }));
      return h('article', { classe: 'carte scenario l-4', vars: { '--c': COULEURS_SCENARIOS[sc.scenario] } },
        h('div', { classe: 'carte-tete' }, h('span', { classe: 'pastille-ico' }, ico(sc.icone)),
          h('h2', {}, h('span', { texte: NOMS_SCENARIOS[sc.scenario] }), h('span', { classe: 'sous', texte: `${pct(sc.poids_pct)} de la population` }))),
        h('p', { classe: 'flux-grand' }, h('span', { classe: 'compte', texte: nb(sc.flux_moyenne) }), h('small', { texte: 'pièces achetées / an' })),
        h('div', { classe: 'fourchette', 'aria-hidden': 'true' },
          h('i', { vars: { '--de': p(sc.flux_min), '--l': (sc.flux_max - sc.flux_min) / 25 * 100 + '%' } }),
          h('u', { vars: { '--x': p(pop.flux) } }), h('b', { vars: { '--m': p(sc.flux_moyenne) } })),
        h('p', { classe: 'part', texte: `De ${nb(sc.flux_min)} à ${nb(sc.flux_max)} ; ${sc.profils.map(id => noms[id]).join(' et ')}` }),
        h('dl', {},
          ligne('Garde-robe', `${nb(sc.garde_robe)} pièces`),
          ligne('Dont dormantes', `${nb(sc.dormant)}`),
          ligne('Durée de résidence', `${nb(sc.duree_ans)} ans`),
          ligne('Port de chaque pièce', `${nb(jours, 0)} jours / an`),
          ligne('Ratio climat', `R ≈ ${nb(climat / jours)}`),
          ligne('Budget médian', euros(sc.budget_mediane)),
          ligne('Part d’occasion', pct(sc.pct_occasion))));
    }));
  }

  /* ----------------------------------------------------- simulateur AESA */
  function simulateur(D, pop) {
    const A = D.aesa;
    const curseurPieces = $('#curseur-pieces'), curseurSimult = $('#curseur-simultanees');
    const etat = { pieces: Math.round(pop.portees * 2) / 2, simultanees: 1, production: A.productions[0].cle };
    const lignes = {};
    const pos = r => (Math.log10(borne(r, 1e-3, 100)) + 3) / 5 * 100;
    const penderie = creerPenderie($('#penderie-aesa'), { capacite: 120, hauteur: 64, graine: 146 });

    const axe = h('div', { classe: 'barre-ligne', 'aria-hidden': 'true' }, h('div', { classe: 'barre-nom' }),
      h('div', { classe: 'axe-graduations' }, [0.001, 0.01, 0.1, 1, 10, 100].map(v =>
        h('span', { classe: v === 1 ? 'limite-texte' : null, vars: { '--x': pos(v) + '%' }, texte: v === 1 ? 'limite' : nb(v, 3) }))),
      h('div', { classe: 'ratio-val', texte: 'R' }));
    $('#graphique-ratios').replaceChildren(axe, ...A.categories.map(c => {
      const piste = h('div', { classe: 'barre-piste ratio-piste' },
        h('i', { classe: 'limite-1', vars: { left: pos(1) + '%' } }), h('i', { classe: 'ratio-seg' }), h('b', { classe: 'ratio-point' }));
      const valeur = h('div', { classe: 'ratio-val' });
      infobulle(piste, () => [c.nom, `R = ${nb(lignes[c.cle].r, 3)} (${c.unite}). La catégorie reste dans sa part de l'espace sûr si R ≤ 1.`]);
      lignes[c.cle] = { piste, valeur, r: 0 };
      return h('div', { classe: 'barre-ligne' }, h('div', { classe: 'barre-nom' }, ico(c.icone), c.nom), piste, valeur);
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
        const x = pos(r), x1 = pos(1), depasse = r > 1;
        seg.style.left = Math.min(x, x1) + '%';
        seg.style.width = Math.abs(x - x1) + '%';
        seg.classList.toggle('depasse', depasse);
        point.style.left = x + '%';
        point.classList.toggle('depasse', depasse);
        lignes[c.cle].valeur.textContent = r < 1e-3 ? '< 0,001' : nb(r, r < 0.1 ? 3 : r < 10 ? 2 : 1);
      }
      const piecesLimite = 365 * etat.simultanees / joursLimite;
      $('#sortie-pieces').textContent = nb(etat.pieces);
      $('#sortie-simultanees').textContent = etat.simultanees === 1 ? '1 (hypothèse de l’article)' : String(etat.simultanees);
      const j = nb(jours, jours < 10 ? 1 : 0);
      $('#verdict-aesa').replaceChildren(`Chaque pièce sert ${j} jours par an (α = ${j}/365). `, pire.r > 1
        ? h('span', {}, `${pire.nom} : `, h('strong', { texte: `${nb(pire.r, pire.r < 10 ? 1 : 0)} fois la limite` }),
          `. Il faudrait au plus ${nb(piecesLimite, 1)} pièces portées.`)
        : h('span', {}, h('strong', { texte: 'Toutes les catégories restent sous la limite.' })));
      const nLimite = Math.max(1, Math.round(piecesLimite));
      penderie.maj({ portees: etat.pieces, dormantes: 0, colorier: i => (i < nLimite ? 'var(--garance)' : 'var(--dort)') });
      $('#penderie-aesa').setAttribute('aria-label', `${Math.round(etat.pieces)} pièces portées, dont ${nb(piecesLimite, 1)} compatibles avec la limite.`);
      $('#legende-penderie-aesa').textContent = `En rouge : les ${nb(piecesLimite, 1)} pièces qui tiendraient dans la limite ; en gris : le reste des ${nb(etat.pieces)} pièces portées.`;
      remplissageCurseur(curseurPieces);
      remplissageCurseur(curseurSimult);
    }

    const portees = sc => Math.round((sc.garde_robe - sc.dormant) * 2) / 2;
    const choixScenario = segments($('#choix-scenario-aesa'), D.scenarios.map(sc => [sc.scenario, NOMS_SCENARIOS[sc.scenario]]), 'population', cle => {
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
  function etVous(D, COULEURS, pop, climat) {
    const champs = ['achats', 'garde-robe', 'budget', 'occasion'].map(n => [n, $('#vous-' + n), $(`#vous-${n}-sortie`)]);
    let fastFashion = false;
    const penderie = creerPenderie($('#penderie-vous'), { capacite: 160, hauteur: 84, graine: 99 });
    const partPortee = pop.portees / pop.garde_robe;
    const ind = cle => D.indicateurs.find(i => i.cle === cle);
    // Échelles : écart P10–P90 / 2,56, soit l'équivalent d'un écart-type pour une loi normale.
    const echelle = cle => (ind(cle).p90 - ind(cle).p10) / 2.56;
    const ECH = { flux: echelle('Q25_RT'), garde_robe: echelle('STOCK_COMP'), budget: (Math.log1p(ind('Q24R').p90) - Math.log1p(ind('Q24R').p10)) / 2.56, occasion: 20 };
    const heros = $('#vous-resultat');

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
      heros.style.setProperty('--c', COULEURS[p.id]);
      $('#vous-profil').textContent = p.profil;
      $('#vous-explication').textContent = `${p.traits} Ce profil achète en moyenne ${nb(p.flux_moyenne)} pièces par an et en possède ${nb(p.garde_robe)}.`;
      $('#vous-rang').textContent = `${pct(rang(achats), 0)} des Français`;
      const portees = gr * partPortee;
      $('#vous-ratio').textContent = `R ≈ ${nb(climat * portees / 365, 1)}`;
      $('#vous-portees').textContent = nb(portees, 0);
      $('#vous-duree').textContent = achats > 0 ? `${nb(gr / achats, 1)} ans` : '–';
      penderie.maj({ portees: Math.min(160, portees), dormantes: Math.max(0, Math.min(160, gr) - Math.round(Math.min(160, portees))), colorier: (i, st) => (st === 'portee' ? '#fff' : null) });
      $('#penderie-vous').setAttribute('aria-label', `Votre penderie : environ ${nb(portees, 0)} pièces portées et ${nb(gr - portees, 0)} dormantes.`);
    }
    champs.forEach(([, c]) => c.addEventListener('input', calculer));
    segments($('#vous-fast-fashion'), [[false, 'Non'], [true, 'Oui']], false, v => { fastFashion = v; calculer(); });
    calculer();
  }

  /* --------------------------------------------------------------- méthode */
  function methode(D) {
    const T = D.tache1;
    const total = T.tri.reduce((a, t) => a + t.nombre, 0);
    $('#tri-variables').replaceChildren(...T.tri.map(t => {
      const classes = [t.texte_sombre ? 'texte-sombre' : '', t.nombre / total < 0.15 ? 'etroit' : ''].join(' ').trim();
      const bloc = h('div', { tabindex: '0', vars: { '--part': t.nombre, '--c': t.couleur }, classe: classes || null },
        h('b', { texte: nb(t.nombre, 0) }), h('small', { texte: t.nom }));
      infobulle(bloc, () => [`${t.code} : ${t.nom} (${nb(t.nombre, 0)})`, t.detail]);
      return bloc;
    }));
    tableau($('#table-tri'), ['Priorité', 'Rôle', 'Variables', 'Part', 'Détail'], T.tri.map(t => [t.code, t.nom, t.nombre, pct(t.nombre / total * 100), t.detail]));

    const NOMS = { ok: 'Conforme', vigilance: 'Vigilance', anomalie: 'Anomalie' };
    const COUL = { ok: 'var(--ok)', vigilance: 'var(--vigilance)', anomalie: 'var(--anomalie)' };
    const compte = st => T.controles.filter(c => c.statut === st).length;
    $('#legende-controles').replaceChildren(...['ok', 'vigilance', 'anomalie'].map(st =>
      h('span', { classe: 'statut', vars: { color: COUL[st] } }, ico(st), h('span', { classe: 'texte-encre', texte: `${NOMS[st]} : ${compte(st)}` }))));
    const detail = $('#controle-detail');
    const boutons = T.controles.map(c => h('button', {
      type: 'button', classe: 'controle ' + c.statut, vars: { '--c': COUL[c.statut] }, 'aria-pressed': 'false',
      'aria-label': `Contrôle ${c.numero} : ${c.controle} (${NOMS[c.statut]})`, texte: String(c.numero), onclick: () => montrer(c),
    }));
    function montrer(c) {
      boutons.forEach((b, i) => b.setAttribute('aria-pressed', String(T.controles[i] === c)));
      detail.replaceChildren(
        h('span', { classe: 'statut', vars: { color: COUL[c.statut] } }, ico(c.statut), `${NOMS[c.statut]}, famille « ${c.famille} »`),
        h('b', { texte: `${c.numero}. ${c.controle}` }),
        h('span', { texte: `Résultat : ${c.resultat}.` }),
        c.action && c.action !== '—' ? h('span', { classe: 'controle-action', texte: `Suite donnée : ${c.action.charAt(0).toLowerCase() + c.action.slice(1)}.` }) : null);
    }
    $('#controles').replaceChildren(...boutons);
    montrer(T.controles.find(c => c.statut === 'anomalie') || T.controles[0]);

    const lim = 5;
    const pos = v => (borne(v, -lim, lim) + lim) / (2 * lim) * 100;
    const fmtUnite = (v, u) => (u === '%' ? pct(v * 100) : u === '€' ? euros(v) : nb(v, 2) + ' ' + u);
    const lignes = T.references.map(r => {
      const piste = h('div', { classe: 'barre-piste' },
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

  /* ================================================================= SAS */
  const b64 = texte => Uint8Array.from(atob(texte.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const versB64 = octets => btoa(String.fromCharCode(...new Uint8Array(octets)));

  async function deriverCle(motDePasse, coffre) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(motDePasse.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(coffre.sel), iterations: coffre.iterations, hash: 'SHA-256' },
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
    demarrer(paquet.donnees);
  }

  async function initialiserSas() {
    const coffre = JSON.parse($('#coffre').textContent);
    creerPenderie($('#sas-penderie'), { capacite: 30, hauteur: 60, graine: 12 }).maj({ portees: 16, dormantes: 10 });

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
