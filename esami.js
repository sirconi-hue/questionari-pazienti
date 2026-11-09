/* Invio di esami e immagini allo studio, con il link personale stampato sul foglio di visita.
   Il codice del link è dopo «#»: il browser non lo invia al sito che ospita la pagina.
   I file scelti (cartella del CD, file ZIP del centro, referti in PDF, foto) si impacchettano qui in un archivio ZIP
   che viaggia in pezzi da 16 MiB, ciascuno cifrato con AES-256-CTR e autenticato con HMAC-SHA256. Le chiavi e la
   descrizione dell'invio sono cifrate con la chiave pubblica dello studio (RSA-OAEP 2048/SHA-256 + AES-GCM 256):
   l'archivio esterno conserva solo dati illeggibili, che solo il computer dello studio può decifrare. */
(function () {
  "use strict";
  const C = window.CONFIG_QUESTIONARI;
  const contenuto = document.getElementById("contenuto");
  const token = decodeURIComponent((location.hash || "").slice(1)).split("/")[0];
  const PEZZO = C.pezzoDicom || 16 * 1024 * 1024, MAX_TOTALE = 750000000, MAX_VOCI = 65000;
  const MAX_FILE = 40, MAX_FILE_BYTE = 50 * 1024 * 1024;

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
  function b64(buf) {
    const u = new Uint8Array(buf); let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function cifraJson(chiaveJwk, dati) {
    const pubblica = await crypto.subtle.importKey("jwk", chiaveJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(dati)));
    const k = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubblica, await crypto.subtle.exportKey("raw", aes));
    return JSON.stringify({ v: 1, k: b64(k), iv: b64(iv), c: b64(c) });
  }
  const mb = b => b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`;

  // ------------------------------------------------------------------ scelta dei file
  async function eDicom(f) {
    if (f.size < 132) return false;
    const b = new Uint8Array(await f.slice(128, 132).arrayBuffer());
    return b[0] === 68 && b[1] === 73 && b[2] === 67 && b[3] === 77;   // «DICM»
  }
  const eZip = f => /\.zip$/i.test(f.name) || /zip/.test(f.type || "");
  const eDocumento = f => /^(image\/|application\/pdf)/.test(f.type || "") || /\.(pdf|jpe?g|png|heic|heif|webp)$/i.test(f.name);
  const pulito = n => (n || "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);

  // S = scelta corrente: { zip, dicom: [File], documenti: [File], ignorati }
  function analizza(S) {
    if (S.zip && (S.dicom.length || S.documenti.length)) throw new Error("Il file ZIP va inviato da solo: invialo, poi manda gli altri file con un secondo invio.");
    if (S.zip) {
      if (S.zip.size > MAX_TOTALE) throw new Error("Il file supera 750 MB: porta il CD in visita o chiedi allo studio un altro modo.");
      return { zip: S.zip, byte: S.zip.size, n_dicom: 0, descrizione: `${S.zip.name} (${mb(S.zip.size)})` };
    }
    if (!S.dicom.length && !S.documenti.length) return null;
    if (S.documenti.length > MAX_FILE) throw new Error(`Al massimo ${MAX_FILE} referti o foto per invio.`);
    const grande = S.documenti.find(f => f.size > MAX_FILE_BYTE);
    if (grande) throw new Error(`«${grande.name}» è troppo grande (massimo 50 MB).`);
    const voci = [...S.dicom.slice(0, MAX_VOCI).map((f, i) => [f, "D" + String(i).padStart(5, "0") + "_" + pulito(f.name)]),
                  ...S.documenti.map((f, i) => [f, "F" + String(i).padStart(3, "0") + "_" + pulito(f.name)])]
      .map(([f, nome]) => ({ f, nome: new TextEncoder().encode(nome) }));
    const byte = voci.reduce((t, v) => t + 30 + v.nome.length + v.f.size + 46 + v.nome.length, 22);
    if (byte > MAX_TOTALE) throw new Error("I file superano 750 MB: porta il CD in visita o invia meno immagini.");
    const parti = [];
    if (S.dicom.length) parti.push(`${S.dicom.length} immagini DICOM`);
    if (S.documenti.length) parti.push(`${S.documenti.length} ${S.documenti.length === 1 ? "referto o foto" : "referti o foto"}`);
    return { voci, byte, n_dicom: S.dicom.length, descrizione: parti.join(" e ") + ` (${mb(byte)})` };
  }

  // archivio ZIP senza compressione, generato un file alla volta
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const scrivi = (dv, campi) => campi.forEach(([o, v, n]) => n === 4 ? dv.setUint32(o, v, true) : dv.setUint16(o, v, true));
  async function* flussoZip(a) {
    if (a.zip) { for (let o = 0; o < a.zip.size; o += 4194304) yield new Uint8Array(await a.zip.slice(o, o + 4194304).arrayBuffer()); return; }
    const centrale = []; let posizione = 0;
    for (const v of a.voci) {
      const dati = new Uint8Array(await v.f.arrayBuffer()), nome = v.nome, crc = crc32(dati);
      const h = new DataView(new ArrayBuffer(30));
      scrivi(h, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 33, 2], [14, crc, 4], [18, dati.length, 4],
                 [22, dati.length, 4], [26, nome.length, 2], [28, 0, 2]]);
      const c = new DataView(new ArrayBuffer(46));
      scrivi(c, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 33, 2], [16, crc, 4], [20, dati.length, 4],
                 [24, dati.length, 4], [28, nome.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, posizione, 4]]);
      centrale.push(new Uint8Array(c.buffer), nome);
      posizione += 30 + nome.length + dati.length;
      yield new Uint8Array(h.buffer); yield nome; yield dati;
    }
    const dimCentrale = centrale.reduce((t, u) => t + u.length, 0);
    for (const u of centrale) yield u;
    const e = new DataView(new ArrayBuffer(22));
    scrivi(e, [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, a.voci.length, 2], [10, a.voci.length, 2], [12, dimCentrale, 4], [16, posizione, 4], [20, 0, 2]]);
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
        const r = await fetch(`${C.supabaseUrl}/storage/v1/object/esami-pazienti/${nome}`, { method: "POST", body: corpo,
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

  // I = invio in corso (si riprende da dove si è fermato se la connessione cade)
  async function invia(I, chiaveStudio, avanzamento) {
    const casuali = n => crypto.getRandomValues(new Uint8Array(n));
    if (!I.chiavi) {
      I.chiavi = { k: casuali(32), m: casuali(32), nonce: casuali(8) };
      I.gruppo = b64(casuali(24)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      I.pezzi = Math.ceil(I.analisi.byte / PEZZO); I.fatti = new Set();
    }
    if (!I.prenotato) {
      const esito = await rpc("esami_prenota", { p_token: token, p_gruppo: I.gruppo, p_byte: I.analisi.byte, p_pezzi: I.pezzi });
      if (esito !== "ok") throw new Error({ spazio: "Lo spazio per gli invii è momentaneamente pieno: riprova tra qualche ora (lo studio scarica gli esami appena può).",
        troppo_grande: "I file superano 750 MB: porta il CD in visita.", troppi: "Troppi invii in poco tempo: riprova tra qualche minuto.",
        rifiutato: "Il link non è più valido (scaduto o revocato): chiedine uno nuovo allo studio." }[esito] || "Invio non accettato.");
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
    const manifesto = { v: 1, gruppo: I.gruppo, k: b64(I.chiavi.k), m: b64(I.chiavi.m), nonce: b64(I.chiavi.nonce),
      byte: I.analisi.byte, pezzo: PEZZO, pezzi: I.pezzi, esame: I.esame, descrizione: I.descrizione, nota: I.nota,
      zip_originale: !!I.analisi.zip, n_dicom: I.analisi.n_dicom,
      file: I.analisi.zip ? [{ nome: I.analisi.zip.name, byte: I.analisi.zip.size }]
                          : I.analisi.voci.filter(v => v.nome[0] === 70).map(v => ({ nome: v.f.name, byte: v.f.size })) };   // 70 = «F»
    const esito = await rpc("esami_consegna", { p_token: token, p_gruppo: I.gruppo, p_manifesto: await cifraJson(chiaveStudio, manifesto) });
    if (esito !== "ok") throw new Error("Invio non accettato: il link potrebbe essere scaduto. Chiedine uno nuovo allo studio.");
  }

  // ------------------------------------------------------------------ pagina
  function modulo(dati) {
    const def = dati.definizione || {};
    document.getElementById("studio").textContent = def.studio || "";
    const esami = def.esami || [];
    const S = { zip: null, dicom: [], documenti: [], ignorati: 0 };
    let analisi = null, inCorso = null;
    const esito = el("p", { class: "tenue" }), avviso = el("p", { class: "errore", hidden: true });
    const quale = el("select", { "aria-label": "Esame" }, esami.map((t, i) => el("option", { value: String(i), testo: t })),
                     el("option", { value: "-1", testo: "Un altro esame" }));
    const descrizione = el("input", { type: "text", maxlength: "200", placeholder: "Es. RM spalla destra" });
    const campoDescr = el("label", { class: "campo", hidden: esami.length > 0 }, el("span", { testo: "Di quale esame si tratta?" }), descrizione);
    quale.addEventListener("change", () => { campoDescr.hidden = quale.value !== "-1"; });
    const nota = el("textarea", { rows: "2", maxlength: "1000", placeholder: "Facoltativo" });

    async function aggiungi(files) {
      avviso.hidden = true; esito.textContent = "Controllo dei file…";
      for (const f of [...files]) {
        if (/(^|\/)(\.|__MACOSX)/.test(f.webkitRelativePath || f.name)) continue;
        if (eZip(f)) S.zip = f;
        else if (await eDicom(f)) S.dicom.push(f);
        else if (eDocumento(f)) S.documenti.push(f);
        else S.ignorati++;
      }
      aggiorna();
    }
    function aggiorna() {
      try {
        analisi = analizza(S);
        esito.textContent = analisi ? "✓ " + analisi.descrizione + (S.ignorati ? ` · ${S.ignorati} file non necessari esclusi (es. programma del CD)` : "")
                                    : (S.ignorati ? "Nessuna immagine DICOM, referto o foto tra i file scelti: per il CD scegli la cartella (di solito «DICOM»)." : "");
        ricomincia.hidden = !analisi && !S.ignorati;
      } catch (e) { analisi = null; esito.textContent = ""; avviso.textContent = e.message; avviso.hidden = false; ricomincia.hidden = false; }
    }
    const cartella = el("input", { type: "file", class: "nascosto", webkitdirectory: true, multiple: true, onchange: ev => { aggiungi(ev.target.files); ev.target.value = ""; } });
    const singoli = el("input", { type: "file", class: "nascosto", multiple: true,
      accept: ".zip,.dcm,.pdf,.jpg,.jpeg,.png,.heic,.heif,application/zip,application/dicom,application/pdf,image/*",
      onchange: ev => { aggiungi(ev.target.files); ev.target.value = ""; } });
    const ricomincia = el("button", { type: "button", class: "piccolo", hidden: true, testo: "Togli i file scelti",
      onclick: () => { Object.assign(S, { zip: null, dicom: [], documenti: [], ignorati: 0 }); inCorso = null; aggiorna(); } });
    const barra = el("div", { class: "avanzamento", hidden: true }, el("span"));
    const stato = el("p", { class: "stato-invio", hidden: true });
    const pulsante = el("button", { type: "button", testo: "Invia allo studio" });
    pulsante.addEventListener("click", async () => {
      avviso.hidden = true;
      if (!analisi) { avviso.textContent = "Scegli prima i file da inviare."; avviso.hidden = false; return; }
      if (quale.value === "-1" && !descrizione.value.trim()) { avviso.textContent = "Indica di quale esame si tratta."; avviso.hidden = false; descrizione.focus(); return; }
      if (!inCorso || inCorso.analisi !== analisi) inCorso = { analisi };
      Object.assign(inCorso, { esame: Number(quale.value), descrizione: quale.value === "-1" ? descrizione.value.trim() : "", nota: nota.value.trim() });
      pulsante.disabled = true; barra.hidden = false; stato.hidden = false;
      stato.textContent = "Invio in corso: tieni aperta questa pagina…";
      try {
        await invia(inCorso, dati.chiave, f => { barra.firstChild.style.width = `${Math.round(f * 100)}%`;
          stato.textContent = `Invio in corso: ${Math.round(f * 100)}% — tieni aperta questa pagina…`; });
        const nome = quale.value === "-1" ? inCorso.descrizione : esami[Number(quale.value)];
        contenuto.replaceChildren(el("div", { class: "fine" },
          el("p", { testo: `Grazie! ${nome ? "«" + nome + "»" : "L'esame"} è stato inviato allo studio.` }),
          el("p", { class: "tenue", testo: "I file sono cifrati: li può leggere solo lo studio, che li riceve appena il suo computer è acceso." }),
          el("button", { type: "button", class: "secondario", testo: "Invia un altro esame", onclick: () => modulo(dati) })));
        window.scrollTo(0, 0);
      } catch (e) {
        avviso.textContent = /HTTP|fetch|network|Failed|rifiutato \d/i.test(e.message)
          ? "Invio interrotto: controlla la connessione e premi di nuovo «Invia»: riprende da dove si è fermato." : e.message;
        avviso.hidden = false; pulsante.disabled = false; stato.hidden = true;
      }
    });

    contenuto.replaceChildren(...[
      el("p", { class: "istruzioni", testo: def.testo || "" }),
      esami.length ? el("p", {}, el("strong", { testo: "Esami richiesti: " }), esami.join(", ")) : null,
      dati.ricevuti ? el("p", { class: "tenue", testo: `Lo studio ha già ricevuto ${dati.ricevuti} ${dati.ricevuti === 1 ? "invio" : "invii"} da questo link.` }) : null,
      el("label", { class: "campo" }, el("span", { testo: "Che cosa invii?" }), quale), campoDescr,
      el("div", { class: "carica-immagini" },
        el("p", { class: "tenue", testo: "Dal computer: inserisci il CD e scegli la cartella (di solito «DICOM»). Dal telefono: scegli il file ZIP ricevuto dal centro, il PDF del referto o la foto. Fino a 750 MB." }),
        el("label", { class: "pulsante-file" }, cartella, "💿 Scegli la cartella del CD"),
        el("label", { class: "pulsante-file" }, singoli, "🗂 Scegli file ZIP, PDF o foto"),
        esito, ricomincia),
      el("label", { class: "campo" }, el("span", { testo: "Note per il medico" }), nota),
      avviso, barra, stato, pulsante,
      el("p", { class: "tenue", testo: `Link valido fino al ${new Date(dati.scadenza + "T12:00").toLocaleDateString("it-IT")}. I file vengono cifrati su questo dispositivo e li può leggere solo lo studio.` })
    ].filter(Boolean));
  }

  (async () => {
    if (!token) return messaggio("Link incompleto: aprilo per intero o inquadra di nuovo il codice QR sul foglio della visita.");
    if (!window.crypto || !crypto.subtle) return messaggio("Questo browser non consente l'invio sicuro: aggiornalo o usa un altro browser.");
    try {
      const dati = await rpc("esami_leggi", { p_token: token });
      if (!dati) return messaggio("Link non valido. Controlla di averlo aperto per intero.");
      if (dati.stato === "scaduto") return messaggio("Il link è scaduto: se devi ancora inviare esami, chiedine uno nuovo allo studio.");
      if (dati.stato !== "aperto") return messaggio("Questo link non è più attivo: per inviare esami contatta lo studio.");
      modulo(dati);
    } catch (e) {
      messaggio("Servizio momentaneamente non raggiungibile: riprova tra qualche minuto.", "errore");
    }
  })();
})();
