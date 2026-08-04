# Connect & Drive — CRM

CRM sur mesure pour Connect & Drive (installateur IRVE, Bezons). Remplace le suivi manuel Gmail + Brevo + tableur.

Construit à partir du cahier des charges: pipeline 4 étapes, automatisations Brevo, intégrations Webflow (Gmail) et Meta Lead Ads, base pour rôles/permissions Phase 2.

## Stack

- **Backend**: Node.js + Express + Prisma
- **Base de données**: PostgreSQL (Supabase ou Neon, tier gratuit)
- **Frontend**: React + Vite (kanban + fiche contact + dashboard)
- **Emailing**: API Brevo
- **Leads**: Webflow (via Gmail API) + Meta Lead Ads (webhook natif)

## État du build

Ce qui est fait et fonctionnel dans ce dépôt:

- Modèle de données complet (`backend/prisma/schema.prisma`): users/rôles, leads, historique de statut, devis, logs d'emails, notes, appels
- API backend complète: auth, CRUD leads, changement de statut avec historique, devis, stats dashboard
- Déclenchement automatique des emails Brevo sur les événements clés (nouveau lead, relance devis, signature)
- Webhook Meta Lead Ads (vérification + réception temps réel)
- Script de récupération des leads Webflow via Gmail (polling)
- Frontend: connexion, vue kanban (drag & drop), fiche contact complète, dashboard stats

Ce qu'il reste à faire pour être 100% opérationnel (voir section Configuration ci-dessous): brancher les vraies clés API (Brevo, Meta, Gmail), créer la base Postgres, déployer.

## 1. Installation locale

### Prérequis
Node.js 18+, un compte Supabase ou Neon (Postgres gratuit).

### Backend

```bash
cd backend
npm install
cp .env.example .env
# éditer .env avec vos vraies valeurs (voir section Configuration)
npx prisma migrate dev --name init
npm run seed        # crée le compte admin Julien
npm run dev          # démarre l'API sur http://localhost:4000
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # démarre sur http://localhost:5173
```

Se connecter avec l'email/mot de passe définis dans `ADMIN_EMAIL` / `ADMIN_PASSWORD` du `.env` backend.

## 2. Configuration des intégrations

### Brevo (emails automatiques)

1. Compte Brevo existant > **Paramètres du compte > SMTP & API > Clés API**
2. Créer/copier une clé API v3
3. Renseigner `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` dans `.env`
4. Le délai de relance des devis se configure avec `QUOTE_REMINDER_DELAY_DAYS` (3-5 jours recommandé)

Sans clé API renseignée, les emails sont simulés (loggés en base avec `success: false`) — le CRM reste utilisable pour tester le reste.

### Meta Lead Ads (Facebook/Instagram)

1. Dans **Meta for Developers**, créer/configurer une app avec le produit **Webhooks**
2. Objet: **Page**, champ à écouter: `leadgen`
3. URL de callback: `https://<votre-domaine-backend>/api/webhooks/meta`
4. Token de vérification: la valeur de `META_VERIFY_TOKEN` dans `.env`
5. Récupérer un **Page Access Token** longue durée pour la page Facebook concernée → `META_PAGE_ACCESS_TOKEN`
6. (Recommandé) renseigner `META_APP_SECRET` pour vérifier la signature des requêtes entrantes

Le webhook reçoit un `leadgen_id`, va chercher les champs du formulaire (dont le code postal) via la Graph API, puis crée le lead automatiquement.

### Webflow (via Gmail)

Comme Webflow n'a pas de webhook natif ici, le CRM lit les notifications par email (`from:notifications@webflow.io`).

1. Créer un projet sur [Google Cloud Console](https://console.cloud.google.com/), activer la **Gmail API**
2. Créer des identifiants OAuth 2.0 (type "Application de bureau")
3. Générer un refresh token pour le compte Gmail qui reçoit les notifications Webflow (via [OAuth Playground](https://developers.google.com/oauthplayground) avec le scope `https://www.googleapis.com/auth/gmail.modify`)
4. Renseigner `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` dans `.env`
5. Le serveur exécute le polling automatiquement toutes les 10 minutes (voir `server.js`) si `GMAIL_REFRESH_TOKEN` est défini

**Important**: le parsing de l'email Webflow (`backend/src/integrations/webflowGmailPoll.js`, fonction `parseWebflowNotification`) est basé sur un format générique "Name: X / Email: Y". Il faudra l'ajuster avec un vrai email Webflow reçu, le format exact dépend du formulaire configuré sur le site.

## 3. Déploiement (tiers gratuits)

- **Base de données**: créer un projet sur [Supabase](https://supabase.com) ou [Neon](https://neon.tech), copier l'URL de connexion dans `DATABASE_URL`
- **Backend**: déployer le dossier `backend/` sur [Railway](https://railway.app) (build command `npm install && npx prisma migrate deploy`, start command `npm start`). Renseigner toutes les variables d'environnement du `.env.example`
- **Frontend**: déployer le dossier `frontend/` sur [Vercel](https://vercel.com) (framework Vite). Configurer une variable/proxy pour pointer vers l'URL du backend Railway (adapter `vite.config.js` ou passer par une variable `VITE_API_URL` si besoin en prod)

## 4. Rôles & permissions (Phase 2)

La table `User` a déjà un champ `role` (`ADMIN`, `COMMERCIAL`, `TECHNICIEN`) et les middlewares `requireAuth`/`requireRole` sont prêts (`backend/src/middleware/auth.js`). Pour activer la Phase 2:

1. Créer les comptes Angélique/Ilham (`COMMERCIAL`) et Kevin/Luc (`TECHNICIEN`) via `prisma/seed.js` ou une future route admin
2. Filtrer les routes `/api/leads` selon le rôle (un commercial ne voit que ses leads assignés — champ `assignedToId` déjà présent)
3. Restreindre les routes de config système à `ADMIN` avec `requireRole("ADMIN")`

## 5. Routage géographique (Phase 2)

Le modèle `User` a déjà des champs `zoneStart`/`zoneEnd` (plage de codes postaux). Il reste à écrire la règle d'attribution automatique (dans `leads.js` route POST, ou dans les intégrations Webflow/Meta) qui assigne `assignedToId` en fonction du `postalCode` du lead.

## 6. Hors périmètre V1 (non développé ici, comme prévu au cahier des charges)

- Comptes actifs pour Angélique, Ilham, Kevin, Luc (structure prête, comptes à créer)
- Routage automatique par zone (structure prête, règle à écrire)
- Application mobile
- Intégration Pennylane (facturation)

## Structure du projet

```
connect-drive-crm/
├── backend/
│   ├── prisma/schema.prisma       # modèle de données
│   ├── prisma/seed.js             # création du compte admin
│   └── src/
│       ├── server.js              # point d'entrée + cron
│       ├── routes/                # auth, leads, quotes, dashboard, webhooks
│       ├── integrations/          # brevo.js, webflowGmailPoll.js
│       ├── jobs/                  # quoteReminders.js (cron relances)
│       └── middleware/auth.js     # JWT + rôles
└── frontend/
    └── src/
        ├── pages/                 # Login, Kanban, ContactDetail, Dashboard
        ├── components/            # NewLeadModal
        └── api/client.js          # client API
```
