# GitHub + déploiement sur la VM GCP

## 1. Créer le dépôt sur GitHub (toi, une fois)

1. [github.com/new](https://github.com/new)
2. **Repository name** : `SpreadsheetBot`
3. **Private** (recommandé : IDs Discord, spreadsheets dans `config/`)
4. **Ne coche pas** « Add README » (le projet en a déjà un)
5. **Create repository**

Repo : `https://github.com/Tadayoshi123/SpreadsheetBot`

## 2. Pousser le code depuis ton PC

Dans PowerShell, à la racine du projet :

```powershell
cd "C:\Users\yanki\OneDrive\Documents\tmp\spreadsheet-bot"

git init
git add .
git status
# Vérifie qu'il n'y a PAS .env dans la liste
git commit -m "Initial commit: SpreadsheetBot Discord + GCP deploy"

git branch -M main
git remote add origin https://github.com/Tadayoshi123/SpreadsheetBot.git
git push -u origin main
```

GitHub te demandera de te connecter (navigateur ou token).

## 3. Cloner sur la VM (terminal navigateur GCP)

```bash
cd ~
git clone https://github.com/Tadayoshi123/SpreadsheetBot.git
cd SpreadsheetBot
cp .env.example .env
nano .env
```

Colle tes secrets Discord, puis configure Google (voir ci-dessous).

**Google sur la VM (recommandé)** :

```bash
nano ~/sa.json
# colle le JSON du compte de service (téléchargé depuis GCP)
chmod 600 ~/sa.json
```

Dans `.env` :

```env
GOOGLE_APPLICATION_CREDENTIALS=/home/TON_USER/sa.json
```

(ne mets pas le JSON sur une ligne dans `.env` — erreur `DECODER routines::unsupported` fréquente)

```bash
chmod 600 .env
chmod +x deploy/gcp/setup-vm.sh
./deploy/gcp/setup-vm.sh
npm run register
```

## 4. Mises à jour plus tard

**PC :**

```powershell
git add .
git commit -m "Description du changement"
git push
```

**VM :**

```bash
cd ~/SpreadsheetBot
git pull
npm ci
npm run build
sudo systemctl restart spreadsheet-bot
```

## Sécurité

- `.env` est dans `.gitignore` — ne le commit **jamais**
- Repo **privé** si `config/tracks.json` contient de vrais IDs
- Sur la VM, crée `.env` à la main (pas via Git)
