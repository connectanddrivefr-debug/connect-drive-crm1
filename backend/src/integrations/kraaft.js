// Intégration Kraaft (API publique — https://developers.kraaft.co/docs)
//
// 1. Chantier passé en "Installation programmée" avec un technicien choisi
//    -> création automatique de la conversation Kraaft du chantier et ajout
//       du technicien (+ Julien) comme membres.
// 2. Synchronisation (cron quotidien + bouton "Synchroniser Kraaft" de la
//    page Stock): lecture des nouveaux messages des conversations de
//    chantier. Pour chaque photo, on lit les codes-barres / QR codes
//    (zxing-wasm, gratuit, en local) ; un numéro de série connu du stock
//    passe la borne en INSTALLEE chez le client du chantier. Les numéros
//    tapés en texte dans la conversation sont aussi reconnus.
//    Les photos ne sont jamais stockées: seul le numéro lu est conservé.
//
// Variables d'environnement:
//   KRAAFT_API_KEY         clé créée dans Kraaft > Paramètres > Clés API (obligatoire)
//   KRAAFT_WORKSPACE_ID    optionnel (sinon: premier espace de la clé)
//   KRAAFT_OWNER_USER_ID   optionnel: ID Kraaft de Julien, ajouté à chaque conversation
const prisma = require("../lib/prisma");
const { normalizeSerial } = require("../lib/serial");

const API = "https://api.kraaft.co/v1";
const OWNER_USER_ID = process.env.KRAAFT_OWNER_USER_ID || "CGrWcMDlllZScWW78Gn3RAC5pX52";

function isConfigured() {
  return Boolean(process.env.KRAAFT_API_KEY);
}

async function kraaft(path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.KRAAFT_API_KEY}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Kraaft ${method} ${path.split("?")[0]} -> ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

async function getState(key) {
  const row = await prisma.kraaftState.findUnique({ where: { key } });
  return row ? row.value : null;
}

async function setState(key, value) {
  await prisma.kraaftState.upsert({ where: { key }, update: { value }, create: { key, value } });
}

async function getWorkspaceId() {
  if (process.env.KRAAFT_WORKSPACE_ID) return process.env.KRAAFT_WORKSPACE_ID;
  const cached = await getState("workspaceId");
  if (cached) return cached;
  const list = await kraaft("/workspaces");
  if (!Array.isArray(list) || !list.length) throw new Error("Aucun espace Kraaft accessible avec cette clé");
  await setState("workspaceId", list[0].workspaceId);
  return list[0].workspaceId;
}

function roomName(lead) {
  const ref = `CD-${lead.id.slice(0, 6).toUpperCase()}`;
  const name = [lead.company, `${lead.firstName || ""} ${lead.lastName || ""}`.trim()].filter(Boolean).join(" – ");
  return [ref, name || lead.email, lead.city].filter(Boolean).join(" – ").slice(0, 120);
}

async function addMember(ws, roomId, userId) {
  await kraaft(`/workspaces/${ws}/rooms/${roomId}/members/${encodeURIComponent(userId)}`, { method: "PUT" });
}

// Crée (si besoin) la conversation du chantier et y ajoute le technicien.
// Ne lève jamais d'erreur: l'éventuel problème est stocké dans kraaftSyncError
// et affiché sur la fiche client.
async function ensureRoomForLead(leadId) {
  if (!isConfigured()) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { installTechnician: true } });
  if (!lead || lead.installationStatus !== "PROGRAMMEE" || !lead.installTechnician) return;

  const errors = [];
  try {
    const ws = await getWorkspaceId();
    let roomId = lead.kraaftRoomId;
    if (!roomId) {
      const room = await kraaft(`/workspaces/${ws}/rooms`, {
        method: "POST",
        // Conversation non privée: la clé API agit comme un "agent" de l'espace
        // (pas comme Julien) et doit garder l'accès pour lire les photos et
        // ajouter les membres. Les invités externes ne voient de toute façon
        // que les conversations dont ils sont membres.
        body: { name: roomName(lead), private: false, emoji: "🔌", members: [] },
      });
      roomId = room.id;
      await prisma.lead.update({ where: { id: lead.id }, data: { kraaftRoomId: roomId } });
    }
    for (const [label, userId] of [
      ["Julien", OWNER_USER_ID],
      [`${lead.installTechnician.firstName} ${lead.installTechnician.lastName || ""}`.trim(), lead.installTechnician.kraaftUserId],
    ]) {
      if (!userId) {
        errors.push(`${label}: pas d'ID Kraaft sur la fiche technicien`);
        continue;
      }
      try {
        await addMember(ws, roomId, userId);
      } catch (e) {
        errors.push(`${label}: ajout refusé par Kraaft (ID Kraaft à vérifier)`);
        console.error("[Kraaft] ajout membre:", e.message);
      }
    }
  } catch (e) {
    console.error("[Kraaft] création conversation:", e.message);
    errors.push(`Création de la conversation impossible (${e.status || "erreur réseau"})`);
  }
  await prisma.lead.update({ where: { id: lead.id }, data: { kraaftSyncError: errors.length ? errors.join(" · ") : null } });
}

// ---------------------------------------------------------------------------
// Lecture des codes sur les photos
// ---------------------------------------------------------------------------
let zxingReady = null;
async function getReader() {
  if (!zxingReady) {
    zxingReady = (async () => {
      const mod = await import("zxing-wasm/reader");
      try {
        // wasm local (évite un téléchargement depuis le CDN à chaque démarrage)
        const fs = require("fs");
        const wasmBinary = fs.readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
        mod.prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
      } catch {
        /* repli: chargement par défaut (CDN jsDelivr) */
      }
      return mod.readBarcodes;
    })();
  }
  return zxingReady;
}

async function readCodesFromImage(url) {
  const res = await fetch(url);
  if (!res.ok) return [];
  const buf = new Uint8Array(await res.arrayBuffer());
  const readBarcodes = await getReader();
  const results = await readBarcodes(buf, { tryHarder: true, maxNumberOfSymbols: 10 });
  return results.map((r) => r.text).filter(Boolean);
}

// Mots du texte qui ressemblent à un numéro de série (lettres + chiffres, 5+)
function candidateTokens(text) {
  if (!text) return [];
  return (String(text).toUpperCase().match(/[A-Z0-9][A-Z0-9\-_.]{4,}/g) || []).filter((t) => !/^\d+$/.test(t) || t.length < 8);
}

// Les ID Kraaft ont été saisis depuis une capture: les caractères ambigus
// (l / I / 1, O / 0) sont comparés de façon tolérante pour corriger la fiche.
function fuzzyId(id) {
  return String(id).replace(/[lI1|]/g, "1").replace(/[O0]/g, "0");
}

async function autoCorrectTechnicianIds(senderIds) {
  if (!senderIds.size) return;
  const techs = await prisma.technician.findMany({ where: { kraaftUserId: { not: null } } });
  const exact = new Set(techs.map((t) => t.kraaftUserId));
  for (const sid of senderIds) {
    if (exact.has(sid) || sid === OWNER_USER_ID) continue;
    const match = techs.filter((t) => fuzzyId(t.kraaftUserId) === fuzzyId(sid));
    if (match.length === 1) {
      await prisma.technician.update({ where: { id: match[0].id }, data: { kraaftUserId: sid } });
      console.log(`[Kraaft] ID corrigé pour ${match[0].firstName}: ${sid}`);
    }
  }
}

async function handleCodes({ codes, event, lead }) {
  let matched = 0;
  const seen = new Set();
  for (const raw of codes) {
    const code = normalizeSerial(raw);
    if (!code || seen.has(code) || /^\d{8,14}$/.test(code)) continue; // ignore EAN produit
    seen.add(code);
    const already = await prisma.kraaftScan.findUnique({ where: { messageId_code: { messageId: event.messageId, code } } });
    if (already) continue;

    const charger = await prisma.charger.findUnique({ where: { serialNumber: code } });
    const sender = event.senderId
      ? await prisma.technician.findFirst({ where: { kraaftUserId: event.senderId } })
      : null;
    const technicianId = sender?.id || lead.installTechnicianId || charger?.technicianId || null;

    let status = "INCONNUE";
    let note = null;
    if (charger) {
      if (charger.status === "INSTALLEE" && charger.leadId && charger.leadId !== lead.id) {
        status = "A_VERIFIER";
        note = "Borne déjà enregistrée comme installée chez un autre client";
      } else {
        status = "RATTACHEE";
        if (!(charger.status === "INSTALLEE" && charger.leadId === lead.id)) {
          await prisma.$transaction([
            prisma.charger.update({
              where: { id: charger.id },
              data: { status: "INSTALLEE", leadId: lead.id, technicianId, installedAt: new Date(event.occurredAt || Date.now()) },
            }),
            prisma.stockMovement.create({
              data: {
                chargerId: charger.id,
                type: "INSTALLATION",
                leadId: lead.id,
                technicianId,
                source: "KRAAFT",
                notes: "Photo du numéro de série postée dans la conversation Kraaft du chantier",
              },
            }),
          ]);
          matched++;
        }
      }
    }
    await prisma.kraaftScan.create({
      data: {
        messageId: event.messageId,
        roomId: event.roomId,
        leadId: lead.id,
        senderId: event.senderId || null,
        code,
        status,
        chargerId: charger?.id || null,
        note,
      },
    });
  }
  return matched;
}

// Traite les nouveaux messages depuis le dernier passage, dans une limite de
// temps (fonctions Vercel courtes). Renvoie { processed, matched, hasMore }.
async function syncMessages({ budgetMs = 8000 } = {}) {
  if (!isConfigured()) return { configured: false };
  const started = Date.now();
  const ws = await getWorkspaceId();
  let after = await getState("messagesCursor");
  let processed = 0;
  let matched = 0;
  let hasMore = true;

  // Conversations de chantier connues (on ignore toutes les autres)
  const leads = await prisma.lead.findMany({
    where: { kraaftRoomId: { not: null } },
    select: { id: true, kraaftRoomId: true, installTechnicianId: true },
  });
  const byRoom = new Map(leads.map((l) => [l.kraaftRoomId, l]));

  while (hasMore && Date.now() - started < budgetMs) {
    const qs = new URLSearchParams({ limit: "500" });
    if (after) qs.set("after", after);
    const res = await kraaft(`/workspaces/${ws}/rooms/messages/events?${qs}`, { raw: true });
    const events = await res.json();
    hasMore = res.headers.get("x-kraaft-has-more") === "true" && events.length > 0;
    if (!events.length) break;
    // Corrige d'abord les ID Kraaft mal recopiés (l/I, O/0) des auteurs de
    // cette page, pour attribuer l'installation au bon technicien.
    await autoCorrectTechnicianIds(new Set(events.map((e) => e.senderId).filter(Boolean)));

    for (const ev of events) {
      if (Date.now() - started > budgetMs) {
        hasMore = true;
        break;
      }
      after = ev.flake;
      processed++;
      const lead = byRoom.get(ev.roomId);
      const content = ev.message && ev.message.after;
      if (!lead || ev.event !== "sent" || !content) continue;

      const codes = [];
      if (content.type === "image" && content.file && content.file.url) {
        try {
          codes.push(...(await readCodesFromImage(content.file.url)));
        } catch (e) {
          console.error("[Kraaft] lecture image:", e.message);
        }
      }
      // Numéro tapé dans le texte / la légende: retenu seulement s'il
      // correspond à une borne du stock (évite les faux positifs).
      const tokens = [...new Set(candidateTokens(content.text).map(normalizeSerial))];
      if (tokens.length) {
        const known = await prisma.charger.findMany({ where: { serialNumber: { in: tokens } }, select: { serialNumber: true } });
        codes.push(...known.map((k) => k.serialNumber));
      }
      const usable = codes;
      if (usable.length) matched += await handleCodes({ codes: usable, event: ev, lead });
    }
    if (after) await setState("messagesCursor", after);
  }

  await setState("lastSyncAt", new Date().toISOString());
  return { configured: true, processed, matched, hasMore };
}

module.exports = { isConfigured, ensureRoomForLead, syncMessages, getState, readCodesFromImage };
