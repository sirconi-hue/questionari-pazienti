/* Compilazione di un questionario dello studio.
   Il codice personale è nella parte del link dopo «#»: il browser non lo invia al sito che ospita la pagina.
   Le risposte vengono cifrate qui, sul telefono, con la chiave pubblica dello studio (RSA-OAEP 2048/SHA-256 +
   AES-GCM 256): l'archivio esterno conserva solo dati illeggibili, che solo il computer dello studio può decifrare. */
(function () {
  "use strict";
  const C = window.CONFIG_QUESTIONARI;
  const contenuto = document.getElementById("contenuto");
  const token = decodeURIComponent((location.hash || "").slice(1));

  function el(tag, attributi, ...figli) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attributi || {})) {
      if (k === "testo") e.textContent = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    figli.flat(Infinity).forEach(f => f != null && e.append(f));
    return e;
  }
  function messaggio(testo, classe) { contenuto.replaceChildren(el("div", { class: classe || "fine" }, el("p", { testo }))); }

  async function rpc(funzione, dati) {
    const r = await fetch(`${C.supabaseUrl}/rest/v1/rpc/${funzione}`, {
      method: "POST", headers: { apikey: C.chiavePubblica, Authorization: `Bearer ${C.chiavePubblica}`,
                                  "Content-Type": "application/json" }, body: JSON.stringify(dati) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  async function cifra(chiaveJwk, risposte) {
    const pubblica = await crypto.subtle.importKey("jwk", chiaveJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(risposte)));
    const k = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubblica, await crypto.subtle.exportKey("raw", aes));
    return JSON.stringify({ v: 1, k: b64(k), iv: b64(iv), c: b64(c) });
  }

  function domanda(d, n) {
    const fs = el("fieldset", { "data-id": d.id }, el("legend", {}, el("span", { class: "numero", testo: n + "." }), d.testo));
    const radio = (i, etichetta) => el("label", {}, el("input", { type: "radio", name: d.id, value: String(i) }), etichetta);
    if (d.tipo === "scala") {
      fs.append(el("div", { class: "scala" }, d.opzioni.map((e, i) => radio(i, d.id === "q1" ? e : String(i)))),
                el("div", { class: "estremi" }, el("span", { testo: d.min || "" }), el("span", { testo: d.max || "" })));
    } else if (d.tipo === "sezioni") {
      d.gruppi.forEach(([titolo, a, b]) => fs.append(el("div", { class: "gruppo", testo: titolo }),
        el("div", { class: "scelte" }, d.opzioni.slice(a, b).map((e, j) => radio(a + j, e.split(": ").slice(1).join(": ") || e)))));
    } else {
      fs.append(el("div", { class: "scelte" }, d.opzioni.map((e, i) => radio(i, e))));
    }
    return fs;
  }

  function modulo(dati) {
    const def = dati.definizione;
    document.title = def.nome;
    document.getElementById("titolo").textContent = def.titolo;
    document.getElementById("studio").textContent = dati.studio || "";
    const lato = { Destro: "destro", Sinistro: "sinistro", Bilaterale: "entrambi i lati" }[dati.lato];
    const istr = el("p", { class: "istruzioni", testo: def.istruzioni + " " });
    if (lato) istr.append(el("strong", { testo: `Lato da considerare: ${lato}.` }));
    const errore = el("p", { class: "errore", hidden: true });
    const titoliSezione = Object.fromEntries((def.sezioni || []).map(([t, primo]) => [primo, t]));
    const form = el("form", {}, def.domande.map((d, i) => [
      titoliSezione[d.id] ? el("h2", { class: "sezione", testo: titoliSezione[d.id] }) : null, domanda(d, i + 1)]));
    const invia = el("button", { type: "submit", testo: "Invia le risposte" });
    form.append(invia, el("p", { class: "tenue", testo: "Le risposte vengono cifrate sul tuo telefono e può leggerle solo lo studio." }));
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const risposte = {};
      def.domande.forEach(d => { const s = form.querySelector(`input[name="${d.id}"]:checked`); if (s) risposte[d.id] = Number(s.value); });
      const mancanti = def.domande.map((d, i) => [d, i + 1]).filter(([d]) => !(d.id in risposte));
      form.querySelectorAll("fieldset").forEach(f => f.classList.toggle("manca", !(f.dataset.id in risposte)));
      if (def.tutte_obbligatorie && mancanti.length) {
        errore.textContent = "Rispondi a tutte le domande (mancano: " + mancanti.map(m => m[1]).join(", ") + ").";
      } else if (mancanti.length * 2 > def.domande.length) {
        errore.textContent = "Rispondi ad almeno metà delle domande.";
      } else {
        invia.disabled = true; invia.textContent = "Invio…";
        try {
          const esito = await rpc("questionario_invia", { p_token: token, p_cifrato: await cifra(dati.chiave, risposte) });
          if (esito === "ok") { messaggio("Grazie! Le risposte sono state inviate allo studio. Puoi chiudere questa pagina."); window.scrollTo(0, 0); return; }
          errore.textContent = "Il questionario non è più compilabile (già inviato o scaduto).";
        } catch (e) {
          errore.textContent = "Invio non riuscito: controlla la connessione e riprova. Le risposte restano qui.";
        }
        invia.disabled = false; invia.textContent = "Invia le risposte";
      }
      errore.hidden = false; errore.scrollIntoView({ block: "center" });
    });
    contenuto.replaceChildren(istr, errore, form);
  }

  (async () => {
    if (!token) return messaggio("Link incompleto: aprilo per intero dal messaggio ricevuto.");
    if (!window.crypto || !crypto.subtle) return messaggio("Questo browser non consente la compilazione sicura: aggiornalo o usa un altro browser.");
    try {
      const dati = await rpc("questionario_leggi", { p_token: token });
      if (!dati) return messaggio("Link non valido. Controlla di averlo aperto per intero.");
      if (dati.stato === "fatto") return messaggio("Questo questionario è già stato compilato. Grazie.");
      if (dati.stato === "scaduto") return messaggio("Il link è scaduto: se devi ancora compilare il questionario, chiedine uno nuovo allo studio.");
      modulo(dati);
    } catch (e) {
      messaggio("Servizio momentaneamente non raggiungibile: riprova tra qualche minuto.", "errore");
    }
  })();
})();
