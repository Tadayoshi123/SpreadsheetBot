# Déployer SpreadsheetBot sur Google Cloud (e2-micro Always Free)

Guide pour une VM **Ubuntu** en région **US** (`us-central1` recommandé), depuis la France.

## 1. Créer la VM (console GCP)

Tu es sur **Compute Engine → Aperçu** du projet **SpreadsheetBot**. Clique **Créer une instance**.

| Champ | Valeur |
|--------|--------|
| **Nom** | `spreadsheet-bot` |
| **Région** | `us-central1` (Iowa) — *obligatoire pour le free tier* |
| **Zone** | `us-central1-a` (ou b/c, peu importe) |
| **Type de machine** | **e2-micro** (0,25–2 vCPU, 1 Go) — vérifie le badge / mention *Elegible for free tier* |
| **Disque de démarrage** | **Ubuntu 22.04 LTS**, **30 Go**, type **Disque persistant standard** (pas Balanced/SSD payant) |
| **Pare-feu** | **Ne coche pas** HTTP/HTTPS — le bot n’a pas besoin de port entrant |
| **Accès SSH** | Ajoute ta **clé publique** (section « Clés SSH ») — voir §2 si tu n’en as pas |

**Créer** → note l’**IP externe** de la VM (liste Instances).

### Éviter les frais surprises

- Une seule VM **e2-micro** dans **us-central1 / us-east1 / us-west1**.
- Disque **standard** ≤ 30 Go.
- Ne crée pas de IP statique réservée, load balancer, ou VM en Europe sur ce projet si tu veux rester à 0 €.

---

## 2. Clé SSH depuis Windows (PowerShell)

```powershell
ssh-keygen -t ed25519 -C "spreadsheet-bot-gcp" -f "$env:USERPROFILE\.ssh\spreadsheet-bot-gcp"
```

Copie le contenu de la clé **publique** :

```powershell
Get-Content "$env:USERPROFILE\.ssh\spreadsheet-bot-gcp.pub"
```

Colle-le dans GCP → création VM → **Clés SSH** (ou *Métadonnées* du projet plus tard).

Connexion (remplace `IP_EXTERNE`) :

```powershell
ssh -i "$env:USERPROFILE\.ssh\spreadsheet-bot-gcp" ubuntu@IP_EXTERNE
```

---

## 3. Envoyer le projet sur la VM

### Option A — Git (si le repo est sur GitHub)

Sur la VM :

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/Tadayoshi123/SpreadsheetBot.git
cd SpreadsheetBot
```

### Option B — Copie depuis ton PC (sans Git public)

Sur **Windows** (PowerShell, dans le dossier parent du projet) :

```powershell
cd "C:\Users\yanki\OneDrive\Documents\tmp"
tar -czf spreadsheet-bot.tgz --exclude=node_modules --exclude=.env --exclude=.git spreadsheet-bot
scp -i "$env:USERPROFILE\.ssh\spreadsheet-bot-gcp" spreadsheet-bot.tgz ubuntu@IP_EXTERNE:~/
```

Sur la VM :

```bash
tar -xzf spreadsheet-bot.tgz
cd ~/spreadsheet-bot
```

---

## 4. Fichier `.env` sur la VM

```bash
cd ~/spreadsheet-bot
cp .env.example .env
nano .env
```

Renseigne au minimum :

- `DISCORD_CLIENT_ID`
- `DISCORD_TOKEN`
- `DISCORD_ALLOWED_ROLE_IDS`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON **sur une ligne**, comme en local)
- `DISCORD_GUILD_ID` si tu utilises des enregistrements par serveur

Vérifie que `config/tracks.json`, `config/guild-tracks.json` et les configs sheet sont présents (copiés avec le projet).

**Permissions :**

```bash
chmod 600 .env
```

---

## 5. Installer et lancer (systemd)

```bash
cd ~/spreadsheet-bot
chmod +x deploy/gcp/setup-vm.sh
./deploy/gcp/setup-vm.sh
```

Logs en direct :

```bash
sudo journalctl -u spreadsheet-bot -f
```

Tu dois voir `Logged in as …` et `Multi-track mode: …`.

---

## 6. Commandes slash (`register`)

À faire **une fois** après changement de commandes — depuis la VM **ou** ton PC (avec le même `.env` / guild IDs) :

```bash
cd ~/spreadsheet-bot
npm run register
```

---

## 7. Mises à jour du bot

```bash
cd ~/spreadsheet-bot
# git pull   OU   re-scp le tarball
npm ci
npm run build
sudo systemctl restart spreadsheet-bot
```

---

## Dépannage

| Problème | Piste |
|----------|--------|
| `Permission denied (publickey)` | Clé SSH mal ajoutée dans GCP ou mauvais utilisateur (`ubuntu`) |
| Bot ne démarre pas | `sudo journalctl -u spreadsheet-bot -n 80` |
| `DECODER routines::unsupported` sur `/add-entry` | Le service ne doit **pas** utiliser `EnvironmentFile=` pour `.env` (JSON Google cassé). Réinstaller le unit file depuis le repo, `daemon-reload`, `restart`. |
| Erreur Google | Partage des spreadsheets avec l’email du compte de service |
| Facturation GCP | Vérifie *Facturation → Rapports* : seule l’e2-micro US + disque standard |

---

## Arrêter / supprimer

```bash
sudo systemctl stop spreadsheet-bot
sudo systemctl disable spreadsheet-bot
```

Dans la console : **Compute Engine → Instances** → arrêter ou supprimer la VM.
