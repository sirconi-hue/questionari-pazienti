/* Questionario anamnestico prima della visita.
   Il link (QR code dello studio) contiene dopo «#» il codice dello studio, che il browser non invia al sito.
   Il paziente si identifica con il codice fiscale; tutte le risposte, codice fiscale compreso, vengono cifrate qui
   sul telefono con la chiave pubblica dello studio (RSA-OAEP 2048/SHA-256 + AES-GCM 256): l'archivio esterno
   conserva solo dati illeggibili, che solo il computer dello studio può decifrare. */
(function () {
  "use strict";
  const C = window.CONFIG_QUESTIONARI;
  const contenuto = document.getElementById("contenuto");
  const codice = decodeURIComponent((location.hash || "").slice(1));

  function el(tag, attributi, ...figli) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attributi || {})) {
      if (k === "testo") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    figli.flat(Infinity).forEach(f => f != null && f !== false && e.append(f));
    return e;
  }
  function messaggio(testo, classe) { contenuto.replaceChildren(el("div", { class: classe || "fine" }, el("p", { testo }))); }

  async function rpc(funzione, dati) {
    const r = await fetch(`${C.supabaseUrl}/rest/v1/rpc/${funzione}`, {
      method: "POST", headers: { apikey: C.chiavePubblica, "Content-Type": "application/json" }, body: JSON.stringify(dati) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  function b64(buf) {  // a blocchi: un file da qualche MB supera i limiti degli argomenti di una funzione
    const u = new Uint8Array(buf); let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // ogni busta ha la sua chiave AES casuale, cifrata con la chiave pubblica dello studio
  async function cifraDati(chiaveJwk, dati) {
    const pubblica = await crypto.subtle.importKey("jwk", chiaveJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, dati);
    const k = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubblica, await crypto.subtle.exportKey("raw", aes));
    return JSON.stringify({ v: 1, k: b64(k), iv: b64(iv), c: b64(c) });
  }
  const cifra = (chiaveJwk, risposte) => cifraDati(chiaveJwk, new TextEncoder().encode(JSON.stringify(risposte)));

  // ------------------------------------------------------------------ referti (foto o PDF)
  const MAX_REFERTI = 8, MAX_PDF = 4 * 1024 * 1024, LATO_MAX = 2400;
  async function preparaReferto(file) {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      if (file.size > MAX_PDF) throw new Error(`«${file.name}» è troppo grande (massimo 4 MB): fotografa le pagine.`);
      return { blob: file, mime: "application/pdf", nome: file.name };
    }
    // foto: ridimensionata e ricompressa in JPEG (testo del referto leggibile, invio più rapido, niente dati GPS)
    let immagine;
    try { immagine = await createImageBitmap(file); } catch (e) { throw new Error(`«${file.name}»: formato non supportato, usa una foto o un PDF.`); }
    const scala = Math.min(1, LATO_MAX / Math.max(immagine.width, immagine.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(immagine.width * scala); tela.height = Math.round(immagine.height * scala);
    tela.getContext("2d").drawImage(immagine, 0, 0, tela.width, tela.height);
    const blob = await new Promise(ok => tela.toBlob(ok, "image/jpeg", 0.85));
    return { blob, mime: "image/jpeg", nome: (file.name || "referto").replace(/\.[^.]+$/, "") + ".jpg" };
  }
  function sezioneReferti(def) {
    R.referti = [];
    const nomiEsami = Object.fromEntries(def.esami);
    const elenco = el("ul", { class: "referti" });
    const avviso = el("p", { class: "errore", hidden: true });
    const input = el("input", { type: "file", accept: "image/*,application/pdf", multiple: true, class: "nascosto", onchange: async ev => {
      avviso.hidden = true;
      for (const f of ev.target.files) {
        if (R.referti.length >= MAX_REFERTI) { avviso.textContent = `Puoi caricare al massimo ${MAX_REFERTI} file.`; avviso.hidden = false; break; }
        try { R.referti.push(Object.assign(await preparaReferto(f), { esame: (R.esami || [])[0] || "" })); }
        catch (e) { avviso.textContent = e.message; avviso.hidden = false; }
      }
      ev.target.value = ""; aggiorna();
    } });
    function aggiorna() {
      elenco.replaceChildren(...R.referti.map((r, i) => el("li", {},
        r.mime.startsWith("image/") ? el("img", { src: URL.createObjectURL(r.blob), alt: "" }) : el("span", { class: "pdf", testo: "PDF" }),
        el("div", {}, el("div", { class: "nome", testo: r.nome }),
          el("select", { "aria-label": "Esame", onchange: ev => { r.esame = ev.target.value; } },
            (R.esami || []).map(k => el("option", { value: k, selected: r.esame === k, testo: nomiEsami[k] })))),
        el("button", { type: "button", class: "piccolo", "aria-label": "Togli", testo: "✕", onclick: () => { R.referti.splice(i, 1); aggiorna(); } }))));
    }
    const box = el("div", { class: "referti-box", hidden: true },
      el("p", { class: "sottotitolo", testo: "Hai il referto? Fotografalo o caricalo (facoltativo)" }),
      el("label", { class: "pulsante-file" }, input, "📷 Fotografa o scegli i referti"),
      avviso, elenco,
      testo("link_immagini", "Link per scaricare le immagini (es. WeTransfer, portale del centro), se ce l'hai", { tipo: "url", max: 500, extra: { inputmode: "url", placeholder: "https://…" } }));
    box.aggiorna = () => {
      box.hidden = !(R.esami || []).length;
      R.referti.forEach(r => { if (!(R.esami || []).includes(r.esame)) r.esame = (R.esami || [])[0] || ""; });
      aggiorna();
    };
    return box;
  }

  // ------------------------------------------------------------------ codice fiscale
  const DISPARI = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
  const ALFABETO = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const FORMA = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
  const normalizzaCf = t => (t || "").replace(/\s/g, "").toUpperCase();
  function cfValido(cf) {
    if (!FORMA.test(cf)) return false;
    let somma = 0;
    for (let i = 0; i < 15; i++) {
      const c = cf[i];
      somma += i % 2 === 0 ? DISPARI[ALFABETO.indexOf(c)] : (/\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65);
    }
    return String.fromCharCode(65 + somma % 26) === cf[15];
  }
  function lettere(t) {
    const s = (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
    return [[...s].filter(c => !"AEIOU".includes(c)), [...s].filter(c => "AEIOU".includes(c))];
  }
  function codiceCognome(t) { const [c, v] = lettere(t); return [...c, ...v, "X", "X", "X"].slice(0, 3).join(""); }
  function codiceNome(t) {
    let [c, v] = lettere(t);
    if (c.length >= 4) c = [c[0], c[2], c[3]];
    return [...c, ...v, "X", "X", "X"].slice(0, 3).join("");
  }
  const femmina = cf => { const g = cf.slice(9, 11).replace(/[LMNPQRSTUV]/g, x => "LMNPQRSTUV".indexOf(x)); return Number(g) > 40; };

  // ------------------------------------------------------------------ elementi del modulo
  const R = {};  // risposte
  function scelta(nome, voci, opzioni) {
    opzioni = opzioni || {};
    const multipla = !!opzioni.multipla;
    return el("div", { class: "scelte" + (opzioni.riga ? " in-riga" : "") }, voci.map(([k, t]) => el("label", {},
      el("input", { type: multipla ? "checkbox" : "radio", name: nome, value: k, onchange: ev => {
        if (multipla) {
          R[nome] = [...document.querySelectorAll(`input[name="${nome}"]:checked`)].map(i => i.value);
        } else R[nome] = ev.target.value;
        if (opzioni.poi) opzioni.poi();
      } }), t)));
  }
  function testo(nome, etichetta, attr) {
    attr = attr || {};
    const campo = el(attr.righe ? "textarea" : "input", Object.assign({ name: nome, rows: attr.righe || null, maxlength: attr.max || 400,
      oninput: ev => { R[nome] = ev.target.value; if (["cf", "nome", "cognome"].includes(nome)) R._cfConfermato = false; } }, attr.righe ? {} : { type: attr.tipo || "text" }, attr.extra || {}));
    return el("label", { class: "campo" }, el("span", { testo: etichetta }), attr.aiuto ? el("small", { class: "tenue", testo: attr.aiuto }) : null, campo);
  }
  function nrs(nome, domanda) {
    return el("fieldset", { "data-id": nome }, el("legend", { testo: domanda }),
      el("div", { class: "scala nrs" }, Array.from({ length: 11 }, (_, i) => el("label", { class: "nrs-" + i },
        el("input", { type: "radio", name: nome, value: String(i), onchange: () => { R[nome] = i; } }), String(i)))),
      el("div", { class: "estremi" }, el("span", { testo: "0 = nessun dolore" }), el("span", { testo: "10 = il peggiore immaginabile" })));
  }
  const domanda = (titolo, ...figli) => el("fieldset", {}, el("legend", { testo: titolo }), figli);

  // ------------------------------------------------------------------ mappa del corpo
  function sezioneMappa(def) {
    const nomi = Object.fromEntries(def.zone);
    R.zone = [];
    const elenco = el("ol", { class: "zone-scelte" });
    const box = el("div", { class: "mappa-paziente" });
    const mappa = new MappaCorpo(box, { nomiZone: nomi, interattiva: true, onScelta: (zona, lato, versante) => {
      const i = R.zone.findIndex(z => z.zona === zona && (z.lato || "") === (lato || "") && (z.versante || "") === (versante || ""));
      if (i >= 0) R.zone.splice(i, 1); else if (R.zone.length < 8) R.zone.push({ zona, lato: lato || "", versante: versante || "" });
      aggiorna();
    } });
    function aggiorna() {
      mappa.evidenzia(R.zone.map((z, i) => Object.assign({}, z, { classe: i === 0 ? "selezionata" : "secondaria" })));
      elenco.replaceChildren(...R.zone.map((z, i) => el("li", {},
        el("span", { testo: nomi[z.zona] + (z.versante ? " – " + z.versante.toLowerCase() : "") }),
        el("select", { "aria-label": "Lato", onchange: ev => { z.lato = ev.target.value; aggiorna(); } },
          [["", "—"], ["Destro", "destra"], ["Sinistro", "sinistra"], ["Bilaterale", "entrambi i lati"]].map(([v, t]) =>
            el("option", { value: v, selected: z.lato === v, testo: t }))),
        i === 0 && R.zone.length > 1 ? el("small", { class: "tenue", testo: "principale" }) : null,
        el("button", { type: "button", class: "piccolo", "aria-label": "Togli", testo: "✕", onclick: () => { R.zone.splice(i, 1); aggiorna(); } }))));
    }
    return domanda("Dove senti dolore? Tocca le zone sulla figura",
      el("p", { class: "tenue", testo: "Se le zone sono più di una, tocca per prima quella che ti fa più male. La figura davanti è vista di fronte: la tua destra è a sinistra dello schermo." }),
      box, elenco);
  }

  // ------------------------------------------------------------------ passi
  function passi(def, dati) {
    const opz = k => def[k];
    const trauma = el("div", { hidden: true }, domanda("C'è stato un contatto o un urto (con una persona, un oggetto, il terreno)?",
      scelta("contatto", opz("si_no_nonso"), { riga: true })));
    const sport = el("div", { hidden: true }, testo("sport", "Quale sport?", { max: 120 }),
      domanda("A che livello?", scelta("livello", opz("livelli"), { riga: true })),
      testo("squadra", "Squadra o società (se ne fai parte)", { max: 120 }));
    const gravidanza = el("div", { hidden: true }, domanda("Sei in gravidanza?", scelta("gravidanza", opz("gravidanza"), { riga: true })));
    const allergie = el("div", { hidden: true }, testo("allergie", "Quali allergie?", { aiuto: "farmaci, lattice, alimenti…" }));
    const referti = sezioneReferti(def);
    return [
      { titolo: "Chi sei", corpo: [
        el("p", { class: "istruzioni", testo: "Rispondi con calma: servono pochi minuti e in visita avremo più tempo per te. Le domande senza risposta si possono saltare." }),
        testo("cf", "Codice fiscale *", { max: 16, extra: { autocapitalize: "characters", autocomplete: "off", spellcheck: "false" } }),
        testo("nome", "Nome *", { max: 80, extra: { autocomplete: "given-name" } }),
        testo("cognome", "Cognome *", { max: 80, extra: { autocomplete: "family-name" } }),
        testo("telefono", "Telefono", { tipo: "tel", max: 30, extra: { autocomplete: "tel" } }),
        testo("email", "Email", { tipo: "email", max: 120, extra: { autocomplete: "email" } }),
        el("details", { class: "informativa" }, el("summary", { testo: "Informativa sul trattamento dei dati" }),
          el("p", { testo: `Titolare del trattamento: ${dati.studio || "lo studio medico"}. Le informazioni, anche sulla salute, servono a preparare la visita e a compilare la cartella clinica (art. 9, par. 2, lett. h, Regolamento UE 2016/679). Sono cifrate su questo telefono e può leggerle solo lo studio; l'archivio esterno che le trasmette (in Unione europea) conserva solo dati illeggibili e li cancella appena lo studio li riceve. Puoi chiedere allo studio di consultare, correggere o cancellare i tuoi dati.` })),
        el("label", { class: "consenso" }, el("input", { type: "checkbox", name: "consenso", onchange: ev => { R.consenso = ev.target.checked; } }),
          "Ho letto l'informativa *"),
      ], controlla: () => {
        R.cf = normalizzaCf(R.cf);
        if (!cfValido(R.cf)) return ["cf", "Il codice fiscale non è corretto: controllalo carattere per carattere."];
        if (!(R.nome || "").trim() || !(R.cognome || "").trim()) return ["nome", "Indica nome e cognome."];
        if ((codiceCognome(R.cognome) + codiceNome(R.nome)) !== R.cf.slice(0, 6) && !R._cfConfermato) {
          R._cfConfermato = true;
          return ["cf", "Il codice fiscale non sembra corrispondere a nome e cognome. Se è corretto, premi di nuovo «Avanti»."];
        }
        if (R.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(R.email)) return ["email", "L'indirizzo email non è valido."];
        if (!R.consenso) return ["consenso", "Per continuare conferma di aver letto l'informativa."];
        gravidanza.hidden = !femmina(R.cf);
      } },
      { titolo: "Il problema", corpo: [
        testo("motivo", "Perché vieni in visita? Raccontalo con parole tue", { righe: 3, max: 2000 }),
        sezioneMappa(def),
        domanda("Da quanto tempo?", scelta("durata", opz("durate")),
          testo("esordio_data", "Se ricordi il giorno in cui è iniziato", { tipo: "date", extra: { max: new Date().toISOString().slice(0, 10) } })),
        domanda("Come è iniziato?", scelta("insorgenza", opz("insorgenza"), { poi: () => { trauma.hidden = R.insorgenza !== "trauma"; } })),
        trauma,
        testo("come", "Come è successo? (movimento, caduta, gesto)", { righe: 2, max: 2000 }),
        domanda("Dove è successo?", scelta("contesto", opz("contesti"), { poi: () => { sport.hidden = R.contesto !== "sport"; } })),
        sport,
      ], controlla: () => {
        if (!(R.motivo || "").trim() && !R.zone.length) return ["motivo", "Racconta il motivo della visita o indica sulla figura dove senti dolore."];
      } },
      { titolo: "Il dolore", corpo: [
        nrs("dolore_riposo", "Quanto è forte il dolore a riposo?"),
        nrs("dolore_attivita", "E durante il movimento o l'attività?"),
        nrs("dolore_peggiore", "Il dolore più forte dell'ultima settimana?"),
        domanda("Il dolore ti sveglia di notte?", scelta("dolore_notturno", opz("si_no_nonso"), { riga: true })),
        domanda("In questo periodo il problema…", scelta("andamento", opz("andamento"))),
        domanda("Hai anche… (puoi sceglierne più di uno)", scelta("sintomi", opz("sintomi"), { multipla: true })),
        el("fieldset", { "data-id": "allarme", class: "allarme" }, el("legend", { testo: "Hai notato qualcuno di questi segni? *" }),
          scelta("allarme", opz("allarme"), { multipla: true, poi: () => { const n = document.querySelector('input[name="nessun_allarme"]'); if (R.allarme.length) { n.checked = false; R.nessun_allarme = false; } } }),
          el("div", { class: "scelte" }, el("label", {}, el("input", { type: "checkbox", name: "nessun_allarme", onchange: ev => {
            R.nessun_allarme = ev.target.checked;
            if (ev.target.checked) { document.querySelectorAll('input[name="allarme"]').forEach(i => { i.checked = false; }); R.allarme = []; }
          } }), el("strong", { testo: "Nessuno di questi" })))),
      ], controlla: () => {
        if (!(R.allarme || []).length && !R.nessun_allarme) return ["allarme", "Rispondi all'ultima domanda (anche «Nessuno di questi»)."];
      } },
      { titolo: "Esami e cure già fatti", corpo: [
        domanda("Hai già fatto esami per questo problema?", scelta("esami", opz("esami"), { multipla: true, poi: () => referti.aggiorna() }),
          testo("esami_note", "Quando e con quale esito, se lo sai", { righe: 2 }), referti),
        el("p", { class: "tenue", testo: "Porta comunque in visita i referti originali e, se le hai, le immagini (CD)." }),
        testo("trattamenti", "Cure già fatte (farmaci, fisioterapia, infiltrazioni…) e con quale risultato", { righe: 3, max: 2000 }),
        testo("obiettivo", "Che cosa ti aspetti dalla visita? (es. tornare a correre, dormire senza dolore)", { righe: 2 }),
      ], controlla: () => {
        R.link_immagini = (R.link_immagini || "").trim();
        if (R.link_immagini && !/^https:\/\/[^\s]+\.[^\s]+$/.test(R.link_immagini)) return ["link_immagini", "Il link deve iniziare con https:// (copialo per intero dal messaggio ricevuto)."];
      } },
      { titolo: "La tua salute", corpo: [
        domanda("Hai o hai avuto…", scelta("patologie", opz("patologie"), { multipla: true }), testo("patologie_altro", "Altre malattie")),
        testo("interventi", "Interventi chirurgici (quali e quando)", { righe: 2 }),
        testo("farmaci", "Farmaci che prendi abitualmente", { righe: 2 }),
        domanda("Prendi anticoagulanti o antiaggreganti (es. Coumadin, Eliquis, Xarelto, Cardioaspirina)?", scelta("anticoagulanti", opz("si_no_nonso"), { riga: true })),
        domanda("Hai allergie?", scelta("allergie_presenti", opz("si_no_nonso"), { riga: true, poi: () => { allergie.hidden = R.allergie_presenti !== "si"; } })),
        allergie,
        gravidanza,
        domanda("Fumi?", scelta("fumo", opz("fumo"), { riga: true })),
        testo("professione", "Lavoro", { max: 120 }),
        testo("attivita", "Sport o attività fisica abituale (quale e quante ore a settimana)"),
        el("div", { class: "due" }, testo("altezza", "Altezza (cm)", { tipo: "number", extra: { inputmode: "numeric", min: 50, max: 250 } }),
          testo("peso", "Peso (kg)", { tipo: "number", extra: { inputmode: "numeric", min: 2, max: 400 } })),
      ] },
    ];
  }

  function risposte() {
    const n = v => (v === undefined || v === "" ? null : Number(v));
    return {
      v: 1,
      paziente: { cf: R.cf, nome: (R.nome || "").trim(), cognome: (R.cognome || "").trim(), telefono: R.telefono || "", email: R.email || "" },
      motivo: R.motivo || "", zone: R.zone || [], durata: R.durata || "", esordio_data: R.esordio_data || "",
      insorgenza: R.insorgenza || "", contatto: R.contatto || "", come: R.come || "", contesto: R.contesto || "",
      sport: R.sport || "", squadra: R.squadra || "", livello: R.livello || "",
      dolore_riposo: n(R.dolore_riposo), dolore_attivita: n(R.dolore_attivita), dolore_peggiore: n(R.dolore_peggiore),
      dolore_notturno: R.dolore_notturno || "", andamento: R.andamento || "", sintomi: R.sintomi || [], allarme: R.allarme || [],
      esami: R.esami || [], esami_note: R.esami_note || "", link_immagini: R.esami && R.esami.length ? (R.link_immagini || "") : "",
      gruppo: R.gruppo || "", referti: (R.esami || []).length ? R.referti.map((r, i) => ({ indice: i, nome: r.nome, mime: r.mime, esame: r.esame })) : [], trattamenti: R.trattamenti || "", obiettivo: R.obiettivo || "",
      patologie: R.patologie || [], patologie_altro: R.patologie_altro || "", interventi: R.interventi || "",
      farmaci: R.farmaci || "", anticoagulanti: R.anticoagulanti || "", allergie: R.allergie_presenti === "si" ? (R.allergie || "") : "",
      allergie_presenti: R.allergie_presenti || "", gravidanza: R.gravidanza || "", fumo: R.fumo || "",
      professione: R.professione || "", attivita: R.attivita || "", altezza: n(R.altezza), peso: n(R.peso),
    };
  }

  function modulo(dati) {
    document.getElementById("studio").textContent = dati.studio || "";
    const elenco = passi(dati.definizione, dati);
    const avanzamento = el("div", { class: "avanzamento" }, el("span"));
    const errore = el("p", { class: "errore", hidden: true });
    const sezioni = elenco.map(p => el("section", { class: "passo", hidden: true }, el("h2", { class: "sezione", testo: p.titolo }), p.corpo));
    const indietro = el("button", { type: "button", class: "secondario", testo: "Indietro" });
    const avanti = el("button", { type: "button", testo: "Avanti" });
    let attuale = 0;
    function mostra(i) {
      attuale = i;
      sezioni.forEach((s, j) => { s.hidden = j !== i; });
      avanzamento.firstChild.style.width = `${(i + 1) / elenco.length * 100}%`;
      document.getElementById("titolo").textContent = `Prima della visita · ${i + 1} di ${elenco.length}`;
      indietro.hidden = i === 0;
      avanti.textContent = i === elenco.length - 1 ? "Invia allo studio" : "Avanti";
      errore.hidden = true;
      window.scrollTo(0, 0);
    }
    indietro.addEventListener("click", () => mostra(attuale - 1));
    sezioni.forEach(s => s.addEventListener("change", () => { errore.hidden = true; }));  // risposta corretta: via l'avviso
    avanti.addEventListener("click", async () => {
      const problema = elenco[attuale].controlla && elenco[attuale].controlla();
      if (problema) {
        errore.textContent = problema[1]; errore.hidden = false;
        const campo = sezioni[attuale].querySelector(`[name="${problema[0]}"], [data-id="${problema[0]}"]`);
        (campo || errore).scrollIntoView({ block: "center" });
        return;
      }
      if (attuale < elenco.length - 1) return mostra(attuale + 1);
      avanti.disabled = true; avanti.textContent = "Invio…";
      try {
        // prima i referti, uno alla volta, poi il questionario che li elenca
        const daInviare = (R.esami || []).length ? R.referti : [];
        if (daInviare.length && !R.gruppo) R.gruppo = b64(crypto.getRandomValues(new Uint8Array(24))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        for (let i = 0; i < daInviare.length; i++) {
          avanti.textContent = `Invio dei referti (${i + 1} di ${daInviare.length})…`;
          const busta = await cifraDati(dati.chiave, new Uint8Array(await daInviare[i].blob.arrayBuffer()));
          const ok = await rpc("anamnesi_allega", { p_codice: codice, p_gruppo: R.gruppo, p_indice: i, p_cifrato: busta });
          if (ok !== "ok") throw new Error(ok);
        }
        avanti.textContent = "Invio…";
        const esito = await rpc("anamnesi_invia", { p_codice: codice, p_cifrato: await cifra(dati.chiave, risposte()) });
        if (esito === "ok") {
          document.getElementById("titolo").textContent = "Grazie!";
          return messaggio("Le risposte sono state inviate allo studio. Puoi chiudere questa pagina: ci vediamo in visita.");
        }
        errore.textContent = esito === "troppi" ? "In questo momento lo studio riceve troppi questionari: riprova tra qualche minuto."
                                                : "Il questionario non è più attivo: chiedi allo studio il nuovo QR code.";
      } catch (e) {
        errore.textContent = "Invio non riuscito: controlla la connessione e riprova. Le risposte restano qui.";
      }
      errore.hidden = false; avanti.disabled = false; avanti.textContent = "Invia allo studio";
    });
    contenuto.replaceChildren(avanzamento, ...sezioni, errore, el("div", { class: "pulsanti" }, indietro, avanti),
      el("p", { class: "tenue", testo: "Le risposte vengono cifrate sul tuo telefono e può leggerle solo lo studio." }));
    mostra(0);
  }

  (async () => {
    if (!codice) return messaggio("Link incompleto: inquadra di nuovo il QR code dello studio.");
    if (!window.crypto || !crypto.subtle) return messaggio("Questo browser non consente la compilazione sicura: aggiornalo o usa un altro browser.");
    try {
      const dati = await rpc("anamnesi_studio", { p_codice: codice });
      if (!dati) return messaggio("Questo QR code non è più attivo: chiedi allo studio quello nuovo.");
      modulo(dati);
    } catch (e) {
      messaggio("Servizio momentaneamente non raggiungibile: riprova tra qualche minuto.", "errore");
    }
  })();
})();
