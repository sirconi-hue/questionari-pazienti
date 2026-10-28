/* Mappa corporea interattiva collegata alla classificazione delle regioni.
   Sagome: react-native-body-highlighter (MIT, vedi mappa_corpo_dati.js); le zone articolari
   assenti nella mappa muscolare originale (gomito, polso, anca, cavo popliteo) sono aggiunte qui.

   Ogni regione della classificazione ha un codice "zona" (colonna cls_regioni.zona_mappa).
   Il lato è ricavato dalla posizione: nella vista anteriore la metà sinistra dell'immagine
   è il lato destro del paziente; nella posteriore è il sinistro. Il versante (anteriore o
   posteriore) è la vista toccata, per le zone che compaiono in entrambe le viste. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const CENTRO = { anteriore: 362, posteriore: 1086 };

  // parte della mappa originale -> zona della classificazione
  const ZONE_PARTI = {
    anteriore: {
      head: "testa", hair: "testa", neck: "cervicale", trapezius: "cervicale", chest: "torace",
      abs: "addome", obliques: "addome", deltoids: "spalla", biceps: "braccio", triceps: "braccio",
      forearm: "avambraccio", hands: "mano", adductors: "anca", quadriceps: "coscia", knees: "ginocchio",
      // il polpaccio visto di fronte resta polpaccio: versante posteriore anche nella vista anteriore
      tibialis: "gamba", calves: ["gamba", "Posteriore"], ankles: "caviglia", feet: "piede",
    },
    posteriore: {
      head: "testa", hair: "testa", neck: "cervicale", trapezius: "dorsale", "upper-back": "dorsale",
      "lower-back": "lombare", gluteal: "bacino", deltoids: "spalla", triceps: "braccio",
      forearm: "avambraccio", hands: "mano", adductors: "coscia", hamstring: "coscia", calves: "gamba",
      ankles: "caviglia", feet: "piede",
    },
  };
  // zone aggiunte: [vista, zona, cx, cy, rx, ry]; il simmetrico viene generato automaticamente
  const ZONE_AGGIUNTE = [
    ["anteriore", "gomito", 202, 496, 24, 20], ["anteriore", "polso", 128, 688, 24, 15],
    ["anteriore", "anca", 258, 622, 24, 34],
    ["posteriore", "gomito", 920, 527, 25, 20], ["posteriore", "polso", 846, 689, 24, 15],
    ["posteriore", "ginocchio", 1006, 993, 30, 22],
  ];
  // regioni sulla linea mediana: cliccandole non si imposta il lato
  const MEDIANE = new Set(["testa", "cervicale", "dorsale", "lombare", "addome"]);
  const VERSANTE_VISTA = { anteriore: "Anteriore", posteriore: "Posteriore" };

  // metà dell'immagine ("left"/"right" nei dati originali, o dalla coordinata x) -> lato del paziente
  function lato(vista, metaImmagine) {
    if (metaImmagine !== "left" && metaImmagine !== "right") return null;
    const aSinistraImmagine = metaImmagine === "left";
    if (vista === "anteriore") return aSinistraImmagine ? "Destro" : "Sinistro";
    return aSinistraImmagine ? "Sinistro" : "Destro";
  }

  function el(nome, attr) {
    const e = document.createElementNS(NS, nome);
    for (const k in attr) e.setAttribute(k, attr[k]);
    return e;
  }

  function disegnaVista(vista, nomiZone) {
    const dati = window.MAPPA_CORPO_DATI[vista];
    const svg = el("svg", { viewBox: dati.viewBox, class: "mappa-vista", role: "img",
                            "aria-label": `Vista ${vista}` });
    svg.append(el("path", { d: dati.contorno, class: "mappa-contorno" }));
    const forme = [];
    const aggiungi = (forma, zona, metaImmagine, versante) => {
      svg.append(forma);
      const f = { forma, zona, vista, lato: lato(vista, metaImmagine), versante: versante || VERSANTE_VISTA[vista] };
      forma.dataset.lato = f.lato || "";
      forme.push(f);
      const titolo = el("title", {});
      titolo.textContent = (nomiZone[zona] || zona) + (f.lato && !MEDIANE.has(zona) ? ` (${f.lato.toLowerCase()})` : "");
      forma.append(titolo);
    };
    for (const p of dati.parti) {
      const voce = ZONE_PARTI[vista][p.slug];
      if (!voce) continue;
      const [zona, versante] = Array.isArray(voce) ? voce : [voce, null];
      aggiungi(el("path", { d: p.d, class: "mappa-zona", "data-zona": zona }), zona, p.lato, versante);
    }
    for (const [v, zona, cx, cy, rx, ry] of ZONE_AGGIUNTE) {
      if (v !== vista) continue;
      for (const x of [cx, 2 * CENTRO[vista] - cx]) {
        aggiungi(el("ellipse", { cx: x, cy, rx, ry, class: "mappa-zona mappa-articolazione", "data-zona": zona }),
                 zona, x < CENTRO[vista] ? "left" : "right");
      }
    }
    const x0 = vista === "anteriore" ? 0 : 724;
    const etichette = vista === "anteriore" ? ["DX", "SX"] : ["SX", "DX"];
    [[x0 + 70, etichette[0]], [x0 + 654, etichette[1]]].forEach(([x, t]) => {
      const e = el("text", { x, y: 70, class: "mappa-lato", "text-anchor": "middle" }); e.textContent = t; svg.append(e);
    });
    const tit = el("text", { x: x0 + 362, y: 1420, class: "mappa-vista-nome", "text-anchor": "middle" });
    tit.textContent = vista === "anteriore" ? "Anteriore" : "Posteriore";
    svg.append(tit);
    return { svg, forme };
  }

  /* opzioni: nomiZone {zona: nome regione}, interattiva (bool), onScelta(zona, lato, versante) */
  function MappaCorpo(contenitore, opzioni) {
    this.forme = [];
    const nomiZone = opzioni.nomiZone || {};
    contenitore.classList.add("mappa-corpo");
    if (opzioni.interattiva) contenitore.classList.add("interattiva");
    for (const vista of ["anteriore", "posteriore"]) {
      const { svg, forme } = disegnaVista(vista, nomiZone);
      contenitore.append(svg);
      this.forme.push(...forme);
    }
    // zone visibili in entrambe le viste: solo per queste il tocco indica anche il versante
    const versanti = {};
    for (const f of this.forme) (versanti[f.zona] = versanti[f.zona] || new Set()).add(f.versante);
    for (const f of this.forme) {
      if (opzioni.interattiva && nomiZone[f.zona]) {
        const versante = versanti[f.zona].size > 1 ? f.versante : null;
        f.forma.addEventListener("click", () => opzioni.onScelta(f.zona, MEDIANE.has(f.zona) ? null : f.lato, versante));
      } else if (!nomiZone[f.zona]) {
        f.forma.classList.add("mappa-inattiva");
      }
    }
  }

  /* selezioni: [{zona, lato, versante, classe}] — lato Destro/Sinistro evidenzia solo quel lato,
     versante Anteriore/Posteriore solo quella vista (mediale, laterale o nessuno: entrambe) */
  MappaCorpo.prototype.evidenzia = function (selezioni) {
    for (const f of this.forme) {
      f.forma.classList.remove("selezionata", "secondaria");
      for (const s of selezioni) {
        if (!s.zona || s.zona !== f.zona) continue;
        const soloLato = s.lato === "Destro" || s.lato === "Sinistro";
        const soloVista = s.versante === "Anteriore" || s.versante === "Posteriore";
        if (soloVista && f.versante !== s.versante) continue;
        if (!soloLato || !f.lato || f.lato === s.lato) f.forma.classList.add(s.classe || "selezionata");
      }
    }
  };

  window.MappaCorpo = MappaCorpo;
})();
