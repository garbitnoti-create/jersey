import { useState, useEffect } from "react";
import {
  collection, addDoc, onSnapshot, updateDoc, deleteDoc, doc, orderBy, query
} from "firebase/firestore";
import { db } from "./firebase";

const EMPTY_FORM = {
  client: "", type: "normal", qte: 1, flocage: "",
  mode: "virement", pctPaye: "100", statut: "En attente",
  prixCustom: "", reduc: false, note: ""
};

function calcPrix(type, qte, reduc, prixCustom) {
  if (prixCustom !== "") return parseFloat(prixCustom) || 0;
  const base = type === "floque" ? 25 : 20;
  let total = base * parseInt(qte || 1);
  if (reduc && parseInt(qte) >= 2) total -= 5;
  return total;
}

function coutAchat(type, qte) {
  return (type === "floque" ? 7 : 5) * parseInt(qte || 1);
}

export default function App() {
  const [page, setPage] = useState("commandes");
  const [commandes, setCommandes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [invest, setInvest] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "commandes"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setCommandes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  function f(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  const prixAuto = calcPrix(form.type, form.qte, form.reduc, form.prixCustom);
  const montantPaye = Math.round(prixAuto * parseInt(form.pctPaye) / 100);
  const resteApayer = prixAuto - montantPaye;

  async function ajouterCommande() {
    if (!form.client.trim()) return alert("Saisis le nom du client");
    await addDoc(collection(db, "commandes"), {
      ...form,
      qte: parseInt(form.qte),
      pctPaye: parseInt(form.pctPaye),
      prix: prixAuto,
      montantPaye,
      resteApayer,
      createdAt: Date.now()
    });
    setShowModal(false);
    setForm(EMPTY_FORM);
  }

  async function solderCommande(id, prix) {
    await updateDoc(doc(db, "commandes", id), { pctPaye: 100, montantPaye: prix, resteApayer: 0 });
  }

  async function updateStatut(id, statut) {
    await updateDoc(doc(db, "commandes", id), { statut });
  }

  async function supprimerCommande(id) {
    if (!confirm("Supprimer cette commande ?")) return;
    await deleteDoc(doc(db, "commandes", id));
  }

  // Stats
  const totalEncaisse = commandes.reduce((s, c) => s + (c.montantPaye || 0), 0);
  const resteTotal = commandes.reduce((s, c) => s + (c.resteApayer || 0), 0);
  const nonSoldees = commandes.filter(c => c.resteApayer > 0).length;

  // Compta
  const totalVir = commandes.filter(c => c.mode === "virement").reduce((s, c) => s + (c.montantPaye || 0), 0);
  const totalEsp = commandes.filter(c => c.mode === "especes").reduce((s, c) => s + (c.montantPaye || 0), 0);
  const diff = totalVir - totalEsp;

  // Bilan
  const ca = commandes.reduce((s, c) => s + (c.prix || 0), 0);
  const achatTotal = commandes.reduce((s, c) => s + coutAchat(c.type, c.qte), 0);
  const benef = ca - achatTotal;
  const benefApresInvest = Math.max(0, benef - invest);
  const partMoi = Math.round(invest + benefApresInvest * 0.4);
  const partAmi = Math.round(benefApresInvest * 0.6);

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
            {commandes.length === 0 && <div style={s.empty}>Aucune commande pour l'instant</div>}
            {commandes.map(c => (
              <div key={c.id} style={s.card}>
                <div style={s.cmdHeader}>
                  <span style={s.cmdName}>{c.client}</span>
                  <span style={s.cmdPrice}>{c.prix}€</span>
                </div>
                <div style={s.cmdDetail}>
                  {c.qte}x maillot {c.type}{c.flocage ? ` · ${c.flocage}` : ""} · {new Date(c.createdAt).toLocaleDateString("fr-FR")}
                </div>
                <div style={s.badges}>
                  <Badge color={c.resteApayer === 0 ? "#2e7d32" : "#c62828"} bg={c.resteApayer === 0 ? "#e8f5e9" : "#ffebee"}>
                    {c.resteApayer === 0 ? "Soldé ✓" : `Reste ${c.resteApayer}€`}
                  </Badge>
                  <Badge color={c.mode === "virement" ? "#1565c0" : "#e65100"} bg={c.mode === "virement" ? "#e3f2fd" : "#fff3e0"}>
                    {c.mode === "virement" ? "Virement" : "Espèces"}
                  </Badge>
                  <Badge color="#555" bg="#f0f0f0">{c.statut}</Badge>
                  {c.reduc && <Badge color="#6a1b9a" bg="#f3e5f5">-5€</Badge>}
                </div>
                <div style={s.progressLabel}>{c.montantPaye}€ payé sur {c.prix}€ ({c.pctPaye}%)</div>
                <div style={s.progressBar}>
                  <div style={{ ...s.progressFill, width: `${c.pctPaye}%` }} />
                </div>
                <div style={s.actions}>
                  {c.resteApayer > 0 && (
                    <button style={{ ...s.btnSm, background: "#e8f5e9", color: "#2e7d32", border: "none" }} onClick={() => solderCommande(c.id, c.prix)}>
                      Solder {c.resteApayer}€
                    </button>
                  )}
                  <select style={{ ...s.btnSm, cursor: "pointer" }} value={c.statut} onChange={e => updateStatut(c.id, e.target.value)}>
                    {["En attente", "Commandé fournisseur", "Livré"].map(s => <option key={s}>{s}</option>)}
                  </select>
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
              <div style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>
                Virements → toi · Espèces → ton ami
              </div>
              <Row label="Virements (toi)" val={totalVir + "€"} />
              <Row label="Espèces (ton ami)" val={totalEsp + "€"} />
              <div style={{ borderTop: "1px solid #eee", marginTop: 10, paddingTop: 10 }}>
                <Row
                  label="Rééquilibrage"
                  val={diff === 0 ? "Équilibré ✓" : diff > 0 ? `Ton ami te doit ${diff}€` : `Tu dois ${Math.abs(diff)}€ à ton ami`}
                  color={diff === 0 ? "#2e7d32" : diff > 0 ? "#1565c0" : "#c62828"}
                  bold
                />
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
                  <Badge color={c.mode === "virement" ? "#1565c0" : "#e65100"} bg={c.mode === "virement" ? "#e3f2fd" : "#fff3e0"}>
                    {c.mode === "virement" ? "Virement → toi" : "Espèces → ami"}
                  </Badge>
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
              <Stat label="Commandes livrées" val={commandes.filter(c => c.statut === "Livré").length} />
            </div>
            <div style={s.sectionTitle}>Répartition</div>
            <div style={{ ...s.card, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#888" }}>Toi (invest. + 40%)</div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{partMoi}€</div>
            </div>
            <div style={{ ...s.card, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#888" }}>Ton ami (60%)</div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{partAmi}€</div>
            </div>
            <div style={s.sectionTitle}>Investissement de départ</div>
            <div style={s.card}>
              <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 6 }}>Montant investi (€)</label>
              <input type="number" min="0" value={invest} onChange={e => setInvest(parseFloat(e.target.value) || 0)} placeholder="0" />
              <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
                Remboursé en priorité avant la répartition 40/60.
              </div>
            </div>
          </>
        )}
      </div>

      <button style={s.fab} onClick={() => setShowModal(true)}>+ Commande</button>

      {showModal && (
        <div style={s.modalBg} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={s.modal}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>Nouvelle commande</h3>

            <Field label="Nom du client">
              <input value={form.client} onChange={e => f("client", e.target.value)} placeholder="Ex: Karim" />
            </Field>

            <div style={s.row}>
              <Field label="Type">
                <select value={form.type} onChange={e => f("type", e.target.value)}>
                  <option value="normal">Normal (20€)</option>
                  <option value="floque">Floqué (25€)</option>
                </select>
              </Field>
              <Field label="Quantité">
                <input type="number" min="1" value={form.qte} onChange={e => f("qte", e.target.value)} />
              </Field>
            </div>

            <Field label="Flocage (nom, numéro...)">
              <input value={form.flocage} onChange={e => f("flocage", e.target.value)} placeholder="Ex: MBAPPÉ 10" />
            </Field>

            <div style={s.row}>
              <Field label="Paiement">
                <select value={form.mode} onChange={e => f("mode", e.target.value)}>
                  <option value="virement">Virement / Revolut</option>
                  <option value="especes">Espèces</option>
                </select>
              </Field>
              <Field label="% Payé">
                <select value={form.pctPaye} onChange={e => f("pctPaye", e.target.value)}>
                  <option value="100">100% (soldé)</option>
                  <option value="50">50% (acompte)</option>
                  <option value="0">0% (pas payé)</option>
                </select>
              </Field>
            </div>

            <Field label={`Prix de vente (auto: ${prixAuto}€)`}>
              <input type="number" value={form.prixCustom} onChange={e => f("prixCustom", e.target.value)} placeholder={`${prixAuto}€ (laisser vide = auto)`} />
            </Field>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "#555" }}>Réduction -5€ (≥2 maillots)</span>
              <input type="checkbox" checked={form.reduc} onChange={e => f("reduc", e.target.checked)} style={{ width: "auto" }} />
            </div>

            <Field label="Statut commande">
              <select value={form.statut} onChange={e => f("statut", e.target.value)}>
                <option>En attente</option>
                <option>Commandé fournisseur</option>
                <option>Livré</option>
              </select>
            </Field>

            <Field label="Note">
              <textarea value={form.note} onChange={e => f("note", e.target.value)} rows={2} placeholder="Ex: flocage long, équipe spéciale..." />
            </Field>

            <div style={{ background: "#f5f5f5", borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 13 }}>
              💰 Prix : <strong>{prixAuto}€</strong> · Payé : <strong>{montantPaye}€</strong> · Reste : <strong>{resteApayer}€</strong>
            </div>

            <button style={s.btnPrimary} onClick={ajouterCommande}>Ajouter la commande</button>
            <button style={s.btnCancel} onClick={() => { setShowModal(false); setForm(EMPTY_FORM); }}>Annuler</button>
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
  navBtn: (active) => ({
    flex: 1, padding: "10px 4px", background: "transparent", border: "none",
    borderBottom: `2px solid ${active ? "#111" : "transparent"}`,
    fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "#111" : "#888", cursor: "pointer"
  }),
  content: { padding: "14px 12px 100px" },
  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 },
  card: { background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: "12px 14px", marginBottom: 8 },
  cmdHeader: { display: "flex", justifyContent: "space-between", marginBottom: 4 },
  cmdName: { fontSize: 15, fontWeight: 700 },
  cmdPrice: { fontSize: 15, fontWeight: 700 },
  cmdDetail: { fontSize: 12, color: "#888", marginBottom: 8 },
  badges: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  progressLabel: { fontSize: 11, color: "#888", marginBottom: 4 },
  progressBar: { background: "#f0f0f0", borderRadius: 4, height: 5, overflow: "hidden", marginBottom: 8 },
  progressFill: { height: "100%", background: "#2e7d32", borderRadius: 4, transition: "width 0.3s" },
  actions: { display: "flex", gap: 6, flexWrap: "wrap" },
  btnSm: { fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer" },
  note: { fontSize: 12, color: "#888", marginTop: 6 },
  sectionTitle: { fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, marginTop: 12 },
  fab: {
    position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
    width: 200, padding: "13px 0", background: "#111", color: "#fff",
    border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", zIndex: 100
  },
  modalBg: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200,
    display: "flex", alignItems: "flex-end", justifyContent: "center"
  },
  modal: {
    background: "#fff", borderRadius: "16px 16px 0 0", padding: "20px 16px 36px",
    width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto"
  },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  btnPrimary: { width: "100%", padding: 13, background: "#111", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" },
  btnCancel: { width: "100%", padding: 11, background: "transparent", border: "1px solid #ddd", borderRadius: 10, fontSize: 14, color: "#888", cursor: "pointer", marginTop: 8 },
  empty: { textAlign: "center", padding: "2rem", color: "#888", fontSize: 14 }
};
