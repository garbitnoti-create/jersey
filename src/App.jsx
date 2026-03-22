import { useState, useEffect } from "react";
import { collection, addDoc, onSnapshot, updateDoc, deleteDoc, doc, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";

const TAILLES = ["XS", "S", "M", "L", "XL", "XXL"];
const EMPTY_ARTICLE = { type: "normal", taille: "M", qte: 1, flocage: "", reduc: false, photo: null };
const EMPTY_FORM = { client: "", articles: [{ ...EMPTY_ARTICLE }], paiements: [{ mode: "virement", montant: "" }], statut: "En attente", note: "" };

function calcPrix(type, qte, reduc) {
  const base = type === "floque" ? 25 : 20;
  let total = base * parseInt(qte || 1);
  if (reduc && parseInt(qte) >= 2) total -= 5;
  return total;
}
function coutAchat(type, qte) { return (type === "floque" ? 7 : 5) * parseInt(qte || 1); }

function compresserImage(file, maxWidth = 600) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [page, setPage] = useState("commandes");
  const [commandes, setCommandes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [invest, setInvest] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedPdf, setSelectedPdf] = useState([]);
  const [modePdf, setModePdf] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "commandes"), orderBy("createdAt", "desc"));
    return onSnapshot(q, snap => {
      setCommandes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, []);

  function updArt(i, k, v) {
    const a = [...form.articles]; a[i] = { ...a[i], [k]: v };
    setForm(f => ({ ...f, articles: a }));
  }
  function addArt() { setForm(f => ({ ...f, articles: [...f.articles, { ...EMPTY_ARTICLE }] })); }
  function rmArt(i) { setForm(f => ({ ...f, articles: f.articles.filter((_, j) => j !== i) })); }
  async function photoArt(i, e) {
    const file = e.target.files[0]; if (!file) return;
    const compressed = await compresserImage(file);
    updArt(i, "photo", compressed);
  }

  function updPay(i, k, v) {
    const p = [...form.paiements]; p[i] = { ...p[i], [k]: v };
    setForm(f => ({ ...f, paiements: p }));
  }
  function addPay() { setForm(f => ({ ...f, paiements: [...f.paiements, { mode: "virement", montant: "" }] })); }
  function rmPay(i) { setForm(f => ({ ...f, paiements: f.paiements.filter((_, j) => j !== i) })); }

  const prixTotal = form.articles.reduce((s, a) => s + calcPrix(a.type, a.qte, a.reduc), 0);
  const montantPaye = form.paiements.reduce((s, p) => s + (parseFloat(p.montant) || 0), 0);
  const resteApayer = Math.max(0, prixTotal - montantPaye);

  function ouvrirModif(c) {
    setEditId(c.id);
    setForm({ client: c.client, articles: c.articles || [{ ...EMPTY_ARTICLE }], paiements: c.paiements || [{ mode: "virement", montant: "" }], statut: c.statut || "En attente", note: c.note || "" });
    setShowModal(true);
  }

  async function sauvegarder() {
    if (!form.client.trim()) return alert("Saisis le nom du client");
    const data = {
      client: form.client,
      articles: form.articles.map(a => ({ ...a, qte: parseInt(a.qte) })),
      paiements: form.paiements.map(p => ({ ...p, montant: parseFloat(p.montant) || 0 })),
      prixTotal, montantPaye, resteApayer,
      statut: form.statut, note: form.note,
    };
    if (editId) {
      await updateDoc(doc(db, "commandes", editId), data);
    } else {
      await addDoc(collection(db, "commandes"), { ...data, createdAt: Date.now() });
    }
    setShowModal(false); setEditId(null); setForm(EMPTY_FORM);
  }

  async function solderCommande(id, prix) { await updateDoc(doc(db, "commandes", id), { montantPaye: prix, resteApayer: 0 }); }
  async function updateStatut(id, statut) { await updateDoc(doc(db, "commandes", id), { statut }); }
  async function supprimerCommande(id) {
    if (!confirm("Supprimer ?")) return;
    await deleteDoc(doc(db, "commandes", id));
  }

  async function genererPDF() {
    const sel = commandes.filter(c => selectedPdf.includes(c.id));
    if (!sel.length) return alert("Sélectionne au moins une commande");
    const lignes = sel.flatMap(c =>
      (c.articles || []).map(a => ({ client: c.client, taille: a.taille, flocage: a.flocage || "", qte: a.qte, type: a.type, photo: a.photo }))
    );
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Commande Fournisseur</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;color:#111}
      h1{font-size:20px;margin-bottom:4px}
      .sub{color:#888;font-size:13px;margin-bottom:24px}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
      .item{border:1px solid #ddd;border-radius:8px;padding:12px;text-align:center}
      .item img{width:140px;height:140px;object-fit:cover;border-radius:6px;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto}
      .no-photo{width:140px;height:140px;background:#f5f5f5;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#aaa;margin:0 auto 8px}
      .client{font-size:13px;font-weight:bold;margin-bottom:4px}
      .detail{font-size:12px;color:#555}
      .flocage{font-size:14px;font-weight:bold;color:#111;margin-top:6px;background:#f5f5f5;padding:4px 8px;border-radius:4px}
    </style></head><body>
    <h1>Commande Fournisseur</h1>
    <div class="sub">Généré le ${new Date().toLocaleDateString("fr-FR")} · ${lignes.length} article(s) · ${sel.length} client(s)</div>
    <div class="grid">
      ${lignes.map(l => `
        <div class="item">
          ${l.photo ? `<img src="${l.photo}">` : `<div class="no-photo">Pas de photo</div>`}
          <div class="client">${l.client}</div>
          <div class="detail">${l.type === "floque" ? "Floqué" : "Normal"} · Taille ${l.taille} · Qté ${l.qte}</div>
          ${l.flocage ? `<div class="flocage">${l.flocage}</div>` : ""}
        </div>`).join("")}
    </div>
    <script>window.onload=()=>window.print()<\/script>
    </body></html>`;
    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
    for (const c of sel) await updateDoc(doc(db, "commandes", c.id), { statut: "Commandé fournisseur" });
    setSelectedPdf([]); setModePdf(false);
  }

  const totalEncaisse = commandes.reduce((s, c) => s + (c.montantPaye || 0), 0);
  const resteTotal = commandes.reduce((s, c) => s + (c.resteApayer || 0), 0);
  const nonSoldees = commandes.filter(c => c.resteApayer > 0).length;
  const totalVir = commandes.reduce((s, c) => s + (c.paiements || []).filter(p => p.mode === "virement").reduce((a, p) => a + p.montant, 0), 0);
  const totalEsp = commandes.reduce((s, c) => s + (c.paiements || []).filter(p => p.mode === "especes").reduce((a, p) => a + p.montant, 0), 0);
  const diff = totalVir - totalEsp;
  const ca = commandes.reduce((s, c) => s + (c.prixTotal || 0), 0);
  const achatTotal = commandes.reduce((s, c) => s + (c.articles || []).reduce((a, art) => a + coutAchat(art.type, art.qte), 0), 0);
  const benef = ca - achatTotal;
  const benefApresInvest = Math.max(0, benef - invest);
  const partCoco = Math.round(invest + benefApresInvest * 0.45);
  const partAdoum = Math.round(benefApresInvest * 0.55);

  const s = styles;

  return (
    <div style={s.app}>
      <div style={s.header}>
        <div style={s.logo}>⚽ Maillots</div>
        <div style={s.nav}>
          {["commandes", "compta", "bilan"].map(p => (
            <button key={p} style={s.navBtn(page === p)} onClick={() => setPage(p)}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={s.content}>
        {loading && <div style={s.empty}>Chargement...</div>}

        {!loading && page === "commandes" && (
          <>
            <div style={s.statGrid}>
              <Stat label="Encaissé" val={totalEncaisse + "€"} />
              <Stat label="Reste à encaisser" val={resteTotal + "€"} color="#e53935" />
              <Stat label="Commandes" val={commandes.length} />
              <Stat label="Non soldées" val={nonSoldees} />
            </div>

            {modePdf ? (
              <div style={{ background: "#e3f2fd", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13 }}>
                <strong>Mode PDF fournisseur</strong> — Sélectionne les commandes à inclure
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button style={{ ...s.btnSm, background: "#1565c0", color: "#fff", border: "none", padding: "6px 12px" }} onClick={genererPDF}>
                    Générer PDF ({selectedPdf.length})
                  </button>
                  <button style={s.btnSm} onClick={() => { setModePdf(false); setSelectedPdf([]); }}>Annuler</button>
                </div>
              </div>
            ) : (
              <button style={{ ...s.btnSm, marginBottom: 12, width: "100%", padding: "10px", background: "#e3f2fd", color: "#1565c0", border: "none", borderRadius: 8 }}
                onClick={() => setModePdf(true)}>
                📄 Générer PDF fournisseur
              </button>
            )}

            {commandes.length === 0 && <div style={s.empty}>Aucune commande pour l'instant</div>}
            {commandes.map(c => (
              <div key={c.id} style={{ ...s.card, border: modePdf && selectedPdf.includes(c.id) ? "2px solid #1565c0" : "1px solid #eee" }}>
                {modePdf && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedPdf.includes(c.id)}
                      onChange={() => setSelectedPdf(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                      style={{ width: "auto" }} />
                    <span style={{ fontSize: 12, color: "#1565c0" }}>Inclure dans le PDF</span>
                  </label>
                )}
                <div style={s.cmdHeader}>
                  <span style={s.cmdName}>{c.client}</span>
                  <span style={s.cmdPrice}>{c.prixTotal}€</span>
                </div>
                <div style={{ marginBottom: 8 }}>
                  {(c.articles || []).map((a, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      {a.photo && <img src={a.photo} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} />}
                      <span style={{ fontSize: 12, color: "#555" }}>{a.qte}x {a.type === "floque" ? "Floqué" : "Normal"} · {a.taille}{a.flocage ? ` · ${a.flocage}` : ""}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{new Date(c.createdAt).toLocaleDateString("fr-FR")}</div>
                </div>
                <div style={s.badges}>
                  <Badge color={c.resteApayer === 0 ? "#2e7d32" : "#c62828"} bg={c.resteApayer === 0 ? "#e8f5e9" : "#ffebee"}>
                    {c.resteApayer === 0 ? "Soldé ✓" : `Reste ${c.resteApayer}€`}
                  </Badge>
                  {(c.paiements || []).map((p, i) => (
                    <Badge key={i} color={p.mode === "virement" ? "#1565c0" : "#e65100"} bg={p.mode === "virement" ? "#e3f2fd" : "#fff3e0"}>
                      {p.mode === "virement" ? "Virement" : "Espèces"} {p.montant}€
                    </Badge>
                  ))}
                  <Badge color="#555" bg="#f0f0f0">{c.statut}</Badge>
                </div>
                <div style={s.progressLabel}>{c.montantPaye}€ payé sur {c.prixTotal}€</div>
                <div style={s.progressBar}>
                  <div style={{ ...s.progressFill, width: `${Math.min(100, Math.round((c.montantPaye / c.prixTotal) * 100))}%` }} />
                </div>
                <div style={s.actions}>
                  {c.resteApayer > 0 && (
                    <button style={{ ...s.btnSm, background: "#e8f5e9", color: "#2e7d32", border: "none" }} onClick={() => solderCommande(c.id, c.prixTotal)}>
                      Solder {c.resteApayer}€
                    </button>
                  )}
                  <select style={{ ...s.btnSm, cursor: "pointer" }} value={c.statut} onChange={e => updateStatut(c.id, e.target.value)}>
                    {["En attente", "Commandé fournisseur", "Livré"].map(st => <option key={st}>{st}</option>)}
                  </select>
                  <button style={{ ...s.btnSm, background: "#fff8e1", color: "#f57f17", border: "none" }} onClick={() => ouvrirModif(c)}>
                    Modifier
                  </button>
                  <button style={{ ...s.btnSm, background: "#ffebee", color: "#c62828", border: "none" }} onClick={() => supprimerCommande(c.id)}>
                    Supprimer
                  </button>
                </div>
                {c.note && <div style={s.note}>📝 {c.note}</div>}
              </div>
            ))}
          </>
        )}

        {!loading && page === "compta" && (
          <>
            <div style={s.card}>
              <div style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>Virements → Coco · Espèces → Adoum</div>
              <Row label="Virements (Coco)" val={totalVir + "€"} />
              <Row label="Espèces (Adoum)" val={totalEsp + "€"} />
              <div style={{ borderTop: "1px solid #eee", marginTop: 10, paddingTop: 10 }}>
                <Row label="Rééquilibrage"
                  val={diff === 0 ? "Équilibré ✓" : diff > 0 ? `Adoum doit ${diff}€ à Coco` : `Coco doit ${Math.abs(diff)}€ à Adoum`}
                  color={diff === 0 ? "#2e7d32" : "#1565c0"} bold />
              </div>
            </div>
            <div style={s.sectionTitle}>Détail par commande</div>
            {commandes.map(c => (
              <div key={c.id} style={s.card}>
                <div style={s.cmdHeader}>
                  <span style={s.cmdName}>{c.client}</span>
                  <span style={s.cmdPrice}>{c.montantPaye}€</span>
                </div>
                <div style={s.badges}>
                  {(c.paiements || []).map((p, i) => (
                    <Badge key={i} color={p.mode === "virement" ? "#1565c0" : "#e65100"} bg={p.mode === "virement" ? "#e3f2fd" : "#fff3e0"}>
                      {p.mode === "virement" ? `Virement ${p.montant}€ → Coco` : `Espèces ${p.montant}€ → Adoum`}
                    </Badge>
                  ))}
                  {c.resteApayer > 0 && <Badge color="#c62828" bg="#ffebee">Reste {c.resteApayer}€</Badge>}
                </div>
              </div>
            ))}
          </>
        )}

        {!loading && page === "bilan" && (
          <>
            <div style={s.statGrid}>
              <Stat label="Chiffre d'affaires" val={ca + "€"} />
              <Stat label="Coût fournisseur" val={achatTotal + "€"} />
              <Stat label="Bénéfice net" val={benef + "€"} color="#2e7d32" />
              <Stat label="Livrées" val={commandes.filter(c => c.statut === "Livré").length} />
            </div>
            <div style={s.sectionTitle}>Répartition</div>
            <div style={{ ...s.card, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#888" }}>Coco (invest. + 40%)</div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{partCoco}€</div>
            </div>
            <div style={{ ...s.card, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#888" }}>Adoum (60%)</div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{partAdoum}€</div>
            </div>
            <div style={s.sectionTitle}>Investissement de départ</div>
            <div style={s.card}>
              <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 6 }}>Montant investi par Coco (€)</label>
              <input type="number" min="0" value={invest} onChange={e => setInvest(parseFloat(e.target.value) || 0)} placeholder="0" />
              <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>Remboursé en priorité avant la répartition 40/60.</div>
            </div>
          </>
        )}
      </div>

      <button style={s.fab} onClick={() => { setEditId(null); setForm(EMPTY_FORM); setShowModal(true); }}>+ Commande</button>

      {showModal && (
        <div style={s.modalBg} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={s.modal}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>{editId ? "Modifier la commande" : "Nouvelle commande"}</h3>

            <Field label="Nom du client">
              <input value={form.client} onChange={e => setForm(f => ({ ...f, client: e.target.value }))} placeholder="Ex: Karim" />
            </Field>

            <div style={s.sectionTitle}>Maillots</div>
            {form.articles.map((a, i) => (
              <div key={i} style={{ background: "#f9f9f9", borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Maillot {i + 1}</span>
                  {form.articles.length > 1 && (
                    <button onClick={() => rmArt(i)} style={{ fontSize: 11, color: "#c62828", background: "none", border: "none", cursor: "pointer" }}>Supprimer</button>
                  )}
                </div>
                <div style={s.row}>
                  <Field label="Type">
                    <select value={a.type} onChange={e => updArt(i, "type", e.target.value)}>
                      <option value="normal">Normal (20€)</option>
                      <option value="floque">Floqué (25€)</option>
                    </select>
                  </Field>
                  <Field label="Taille">
                    <select value={a.taille} onChange={e => updArt(i, "taille", e.target.value)}>
                      {TAILLES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={s.row}>
                  <Field label="Quantité">
                    <input type="number" min="1" value={a.qte} onChange={e => updArt(i, "qte", e.target.value)} />
                  </Field>
                  <Field label="Flocage">
                    <input value={a.flocage} onChange={e => updArt(i, "flocage", e.target.value)} placeholder="Ex: MBAPPÉ 10" />
                  </Field>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "#555" }}>Réduction -5€ (≥2)</span>
                  <input type="checkbox" checked={a.reduc} onChange={e => updArt(i, "reduc", e.target.checked)} style={{ width: "auto" }} />
                </div>
                <Field label="Photo du maillot">
                  <input type="file" accept="image/*" onChange={e => photoArt(i, e)} />
                </Field>
                {a.photo && (
                  <div style={{ position: "relative", display: "inline-block", marginTop: 6 }}>
                    <img src={a.photo} style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 6 }} />
                    <button onClick={() => updArt(i, "photo", null)} style={{ position: "absolute", top: -4, right: -4, background: "#c62828", color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, fontSize: 11, cursor: "pointer" }}>×</button>
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>Sous-total : {calcPrix(a.type, a.qte, a.reduc)}€</div>
              </div>
            ))}
            <button onClick={addArt} style={{ ...s.btnSm, marginBottom: 12, width: "100%", padding: "8px" }}>+ Ajouter un maillot</button>

            <div style={s.sectionTitle}>Paiements</div>
            {form.paiements.map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <select value={p.mode} onChange={e => updPay(i, "mode", e.target.value)} style={{ flex: 1 }}>
                  <option value="virement">Virement / Revolut</option>
                  <option value="especes">Espèces</option>
                </select>
                <input type="number" placeholder="Montant €" value={p.montant} onChange={e => updPay(i, "montant", e.target.value)} style={{ flex: 1 }} />
                {form.paiements.length > 1 && (
                  <button onClick={() => rmPay(i)} style={{ color: "#c62828", background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>×</button>
                )}
              </div>
            ))}
            <button onClick={addPay} style={{ ...s.btnSm, marginBottom: 12, width: "100%", padding: "8px" }}>+ Ajouter un paiement</button>

            <Field label="Statut commande">
              <select value={form.statut} onChange={e => setForm(f => ({ ...f, statut: e.target.value }))}>
                <option>En attente</option>
                <option>Commandé fournisseur</option>
                <option>Livré</option>
              </select>
            </Field>

            <Field label="Note">
              <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2} placeholder="Ex: flocage long, équipe spéciale..." />
            </Field>

            <div style={{ background: "#f5f5f5", borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 13 }}>
              💰 Total : <strong>{prixTotal}€</strong> · Payé : <strong>{montantPaye}€</strong> · Reste : <strong>{resteApayer}€</strong>
            </div>

            <button style={s.btnPrimary} onClick={sauvegarder}>{editId ? "Enregistrer les modifications" : "Ajouter la commande"}</button>
            <button style={s.btnCancel} onClick={() => { setShowModal(false); setEditId(null); setForm(EMPTY_FORM); }}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, val, color }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#111" }}>{val}</div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{label}</div>
    </div>
  );
}
function Badge({ color, bg, children }) {
  return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, color, background: bg, fontWeight: 600 }}>{children}</span>;
}
function Row({ label, val, color, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 700 : 500, color: color || "#111" }}>{val}</span>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const styles = {
  app: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#f5f5f5" },
  header: { background: "#fff", borderBottom: "1px solid #eee", padding: "14px 16px 0", position: "sticky", top: 0, zIndex: 100 },
  logo: { fontSize: 18, fontWeight: 800, marginBottom: 10 },
  nav: { display: "flex", gap: 0 },
  navBtn: (active) => ({ flex: 1, padding: "10px 4px", background: "transparent", border: "none", borderBottom: `2px solid ${active ? "#111" : "transparent"}`, fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "#111" : "#888", cursor: "pointer" }),
  content: { padding: "14px 12px 100px" },
  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 },
  card: { background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 8 },
  cmdHeader: { display: "flex", justifyContent: "space-between", marginBottom: 4 },
  cmdName: { fontSize: 15, fontWeight: 700 },
  cmdPrice: { fontSize: 15, fontWeight: 700 },
  badges: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  progressLabel: { fontSize: 11, color: "#888", marginBottom: 4 },
  progressBar: { background: "#f0f0f0", borderRadius: 4, height: 5, overflow: "hidden", marginBottom: 8 },
  progressFill: { height: "100%", background: "#2e7d32", borderRadius: 4, transition: "width 0.3s" },
  actions: { display: "flex", gap: 6, flexWrap: "wrap" },
  btnSm: { fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer" },
  note: { fontSize: 12, color: "#888", marginTop: 6 },
  sectionTitle: { fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  fab: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", width: 200, padding: "13px 0", background: "#111", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", zIndex: 100 },
  modalBg: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" },
  modal: { background: "#fff", borderRadius: "16px 16px 0 0", padding: "20px 16px 36px", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  btnPrimary: { width: "100%", padding: 13, background: "#111", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" },
  btnCancel: { width: "100%", padding: 11, background: "transparent", border: "1px solid #ddd", borderRadius: 10, fontSize: 14, color: "#888", cursor: "pointer", marginTop: 8 },
  empty: { textAlign: "center", padding: "2rem", color: "#888", fontSize: 14 }
};
