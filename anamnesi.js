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
      avviso, elenco, sezioneImmagini(def));
    box.aggiorna = () => {
      box.hidden = !(R.esami || []).length;
      R.referti.forEach(r => { if (!(R.esami || []).includes(r.esame)) r.esame = (R.esami || [])[0] || ""; });
      aggiorna();
      if (box.aggiornaImmagini) box.aggiornaImmagini();
    };
    box.aggiornaImmagini = box.lastChild.aggiorna;
    return box;
  }

  // ------------------------------------------------------------------ immagini DICOM
  // Dal computer si sceglie la cartella del CD (si tengono solo i file DICOM, non il programma di visualizzazione)
  // oppure un file ZIP; i file DICOM scelti si impacchettano in un archivio ZIP. L'archivio viaggia in pezzi da
  // 16 MiB, ciascuno cifrato con AES-256-CTR e autenticato con HMAC-SHA256; le chiavi sono nel questionario cifrato.
  const PEZZO = C.pezzoDicom || 16 * 1024 * 1024, MAX_DICOM = 750000000, MAX_VOCI = 65000;
  const IMG_ESAMI = ["rm", "tac", "rx", "eco"];
  async function eDicom(f) {
    if (f.size < 132) return false;
    const b = new Uint8Array(await f.slice(128, 132).arrayBuffer());
    return b[0] === 68 && b[1] === 73 && b[2] === 67 && b[3] === 77;   // «DICM»
  }
  const eZip = f => /\.zip$/i.test(f.name) || /zip/.test(f.type || "");
  async function analizza(files) {
    files = [...files].filter(f => !/(^|\/)(\.|__MACOSX)/.test(f.webkitRelativePath || f.name));
    const zip = files.filter(eZip);
    if (zip.length === 1 && files.length === 1) {
      if (zip[0].size > MAX_DICOM) throw new Error("L'archivio supera 750 MB: manda allo studio un link (es. WeTransfer).");
      return { zip: zip[0], byte: zip[0].size, file: 0, descrizione: `${zip[0].name} (${mb(zip[0].size)})` };
    }
    const voci = [];
    for (const f of files) {
      if (voci.length >= MAX_VOCI) break;
      if (await eDicom(f)) voci.push(f);
    }
    if (!voci.length) throw new Error(zip.length ? "Scegli un solo file ZIP." : "Nessuna immagine DICOM trovata: scegli la cartella del CD (di solito «DICOM») o il file ZIP.");
    const nomi = voci.map((f, i) => new TextEncoder().encode(String(i).padStart(5, "0") + "_" + (f.name || "img").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60)));
    const byte = voci.reduce((t, f, i) => t + 30 + nomi[i].length + f.size + 46 + nomi[i].length, 22);
    if (byte > MAX_DICOM) throw new Error("Le immagini superano 750 MB: manda allo studio un link (es. WeTransfer) o porta il CD.");
    return { voci, nomi, byte, file: voci.length, descrizione: `${voci.length} immagini DICOM (${mb(byte)})` };
  }
  const mb = b => b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`;
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  // archivio ZIP senza compressione (le immagini DICOM si comprimono poco), generato un file alla volta
  async function* flussoZip(a) {
    if (a.zip) { for (let o = 0; o < a.zip.size; o += 4194304) yield new Uint8Array(await a.zip.slice(o, o + 4194304).arrayBuffer()); return; }
    const centrale = []; let posizione = 0;
    for (let i = 0; i < a.voci.length; i++) {
      const dati = new Uint8Array(await a.voci[i].arrayBuffer()), nome = a.nomi[i], crc = crc32(dati);
      const h = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 33, 2], [14, crc, 4], [18, dati.length, 4],
       [22, dati.length, 4], [26, nome.length, 2], [28, 0, 2]].forEach(([o, v, n]) => n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
      const c = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 33, 2], [16, crc, 4], [20, dati.length, 4],
       [24, dati.length, 4], [28, nome.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, posizione, 4]]
        .forEach(([o, v, n]) => n === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
      centrale.push(new Uint8Array(c.buffer), nome);
      posizione += 30 + nome.length + dati.length;
      yield new Uint8Array(h.buffer); yield nome; yield dati;
    }
    const dimCentrale = centrale.reduce((t, u) => t + u.length, 0);
    for (const u of centrale) yield u;
    const e = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, a.voci.length, 2], [10, a.voci.length, 2], [12, dimCentrale, 4], [16, posizione, 4], [20, 0, 2]]
      .forEach(([o, v, n]) => n === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
    yield new Uint8Array(e.buffer);
  }
  async function* aPezzi(sorgente) {
    let buf = new Uint8Array(PEZZO), pos = 0;
    for await (const parte of sorgente) {
      for (let off = 0; off < parte.length;) {
        const n = Math.min(PEZZO - pos, parte.length - off);
        buf.set(parte.subarray(off, off + n), pos); pos += n; off += n;
        if (pos === PEZZO) { yield buf; buf = new Uint8Array(PEZZO); pos = 0; }
      }
    }
    if (pos) yield buf.subarray(0, pos);
  }
  async function caricaPezzo(nome, corpo) {
    for (let tentativo = 0; ; tentativo++) {
      try {
        const r = await fetch(`${C.supabaseUrl}/storage/v1/object/anamnesi-dicom/${nome}`, { method: "POST", body: corpo,
          headers: { apikey: C.chiavePubblica, "Content-Type": "application/octet-stream" } });   // senza x-upsert: mai sovrascrivere
        if (r.ok) return;
        const testo = await r.text();
        if (r.status === 409 || /duplicate|already exists/i.test(testo)) return;   // già caricato in un tentativo precedente
        if (r.status < 500 || tentativo >= 3) throw new Error("rifiutato " + r.status);
      } catch (e) {
        if (tentativo >= 3 || /rifiutato/.test(e.message)) throw e;
      }
      await new Promise(ok => setTimeout(ok, 2000 * 2 ** tentativo));
    }
  }
  async function inviaImmagini(chiavePubblica, avanzamento) {
    const I = R.dicom;
    if (!I.chiavi) {
      const casuali = n => crypto.getRandomValues(new Uint8Array(n));
      I.chiavi = { k: casuali(32), m: casuali(32), nonce: casuali(8) };
      I.gruppo = b64(casuali(24)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      I.pezzi = Math.ceil(I.analisi.byte / PEZZO); I.fatti = new Set();
    }
    if (!I.prenotato) {
      const esito = await rpc("anamnesi_prenota", { p_codice: codice, p_gruppo: I.gruppo, p_byte: I.analisi.byte, p_pezzi: I.pezzi });
      if (esito !== "ok") throw new Error({ spazio: "Lo spazio per le immagini è momentaneamente pieno: indica un link (es. WeTransfer) o porta il CD.",
        troppo_grande: "Le immagini superano 750 MB: indica un link o porta il CD.", troppi: "Troppi invii in questo momento: riprova tra qualche minuto." }[esito]
        || "Caricamento delle immagini non accettato.");
      I.prenotato = true;
    }
    const kAes = await crypto.subtle.importKey("raw", I.chiavi.k, { name: "AES-CTR" }, false, ["encrypt"]);
    const kMac = await crypto.subtle.importKey("raw", I.chiavi.m, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    let n = 0;
    for await (const pezzo of aPezzi(flussoZip(I.analisi))) {
      if (!I.fatti.has(n)) {
        const iv = new Uint8Array(16); iv.set(I.chiavi.nonce); new DataView(iv.buffer).setUint32(8, n);
        const cifrato = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 32 }, kAes, pezzo));
        const firmato = new Uint8Array(16 + cifrato.length); firmato.set(iv); firmato.set(cifrato, 16);
        const tag = new Uint8Array(await crypto.subtle.sign("HMAC", kMac, firmato));
        await caricaPezzo(`${I.gruppo}/${n}`, new Blob([cifrato, tag], { type: "application/octet-stream" }));
        I.fatti.add(n);
      }
      n++;
      avanzamento(n / I.pezzi);
    }
    I.completo = true;
  }
  function sezioneImmagini(def) {
    R.dicom = {};
    const nomiEsami = Object.fromEntries(def.esami);
    const esito = el("p", { class: "tenue" }), avviso = el("p", { class: "errore", hidden: true });
    const sceltaEsame = el("select", { "aria-label": "Esame delle immagini", onchange: ev => { R.dicom.esame = ev.target.value; } });
    async function scelti(files) {
      avviso.hidden = true; esito.textContent = "Controllo dei file…";
      R.dicom = { esame: R.dicom.esame };
      try { R.dicom.analisi = await analizza(files); esito.textContent = "✓ " + R.dicom.analisi.descrizione; }
      catch (e) { esito.textContent = ""; avviso.textContent = e.message; avviso.hidden = false; }
    }
    const cartella = el("input", { type: "file", class: "nascosto", webkitdirectory: true, multiple: true, onchange: ev => scelti(ev.target.files) });
    const singoli = el("input", { type: "file", class: "nascosto", multiple: true, accept: ".zip,.dcm,application/zip,application/dicom,*/*", onchange: ev => scelti(ev.target.files) });
    const link = el("div", { hidden: true }, testo("link_immagini", "Link per scaricare le immagini", { tipo: "url", max: 500, extra: { inputmode: "url", placeholder: "https://…" } }));
    const carica = el("div", { hidden: true, class: "carica-immagini" },
      el("p", { class: "tenue", testo: "Dal computer: inserisci il CD e scegli la cartella (di solito «DICOM»). Dal telefono: scegli il file ZIP ricevuto dal centro. Fino a 750 MB; l'invio può richiedere alcuni minuti." }),
      el("label", { class: "pulsante-file" }, cartella, "💿 Scegli la cartella del CD"),
      el("label", { class: "pulsante-file" }, singoli, "🗂 Scegli file ZIP o DICOM"),
      esito, avviso, el("label", { class: "campo" }, el("span", { testo: "Di quale esame sono le immagini?" }), sceltaEsame));
    const contenitore = el("div", { class: "immagini" },
      domanda("Hai anche le immagini (RM, TAC, radiografie)?", scelta("immagini", def.immagini || [["link", "Ho un link per scaricarle"], ["carica", "Le carico adesso"], ["cd", "Le porto in visita su CD"], ["no", "Non ho le immagini"]], { poi: () => contenitore.aggiorna() })), link, carica);
    contenitore.aggiorna = () => {
      link.hidden = R.immagini !== "link"; carica.hidden = R.immagini !== "carica";
      const esami = (R.esami || []).filter(k => k !== "sangue");
      if (!esami.includes(R.dicom.esame)) R.dicom.esame = IMG_ESAMI.find(k => esami.includes(k)) || esami[0] || "";
      sceltaEsame.replaceChildren(...esami.map(k => el("option", { value: k, selected: R.dicom.esame === k, testo: nomiEsami[k] })));
    };
    return contenitore;
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
        if (!(R.esami || []).length) return;
        if (R.immagini === "link" && !/^https:\/\/[^\s]+\.[^\s]+$/.test(R.link_immagini)) return ["link_immagini", "Il link deve iniziare con https:// (copialo per intero dal messaggio ricevuto)."];
        if (R.immagini === "carica" && !R.dicom.analisi) return ["immagini", "Scegli la cartella del CD o il file ZIP con le immagini (oppure un'altra risposta)."];
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
      esami: R.esami || [], esami_note: R.esami_note || "", link_immagini: (R.esami || []).length && R.immagini === "link" ? (R.link_immagini || "") : "",
      immagini: (R.esami || []).length ? (R.immagini || "") : "",
      dicom: R.dicom && R.dicom.completo ? { gruppo: R.dicom.gruppo, k: b64(R.dicom.chiavi.k), m: b64(R.dicom.chiavi.m), nonce: b64(R.dicom.chiavi.nonce),
        byte: R.dicom.analisi.byte, pezzo: PEZZO, pezzi: R.dicom.pezzi, file: R.dicom.analisi.file, esame: R.dicom.esame } : null,
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
        if ((R.esami || []).length && R.immagini === "carica" && R.dicom.analisi && !R.dicom.completo) {
          stato.hidden = false;
          await inviaImmagini(dati.chiave, f => {
            stato.textContent = `Invio delle immagini: ${Math.round(f * 100)}% – non chiudere la pagina.`;
            avanti.textContent = `Immagini ${Math.round(f * 100)}%…`;
          });
          stato.hidden = true;
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
        stato.hidden = true;
        errore.textContent = /^(Lo spazio|Le immagini|Troppi|Caricamento)/.test(e.message) ? e.message
          : "Invio non riuscito: controlla la connessione e riprova. Le risposte restano qui" + (R.dicom && R.dicom.fatti && R.dicom.fatti.size ? " e l'invio delle immagini riprende da dove si è fermato." : ".");
      }
      errore.hidden = false; avanti.disabled = false; avanti.textContent = "Invia allo studio";
    });
    const stato = el("p", { class: "stato-invio", hidden: true });
    contenuto.replaceChildren(avanzamento, ...sezioni, errore, stato, el("div", { class: "pulsanti" }, indietro, avanti),
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
