# SiteWebIleDeRe

Application web locale (SPA) pour simuler le coût annuel d'une maison, la répartition des charges et des semaines (ISO, 52/53), avec sauvegarde/chargement JSON.

- Prix d'achat et amortissement (années)
- Charges récurrentes et amorties
- Participants (parts %, coût d'emprunt)
- Accès & catégories (multiplicateurs)
- Répartition des semaines avec prix suggéré/révisé (le révisé influence le suggéré des autres)

Repo GitHub: https://github.com/Yann-le-Chevoir/SiteWebIleDeRe

## Démarrer en local (recommandé)

Utilisez l’extension VS Code "Live Server":

1. Ouvrez ce dossier dans VS Code.
2. Installez l’extension Ritwick Dey – Live Server.
3. Cliquez droit sur `index.html` > "Open with Live Server".
4. Le navigateur s’ouvre sur http://127.0.0.1:5500 et les modifications sont rechargées automatiquement.

## Déployer avec persistance (Render)

Cette app inclut un petit serveur Node/Express qui sert les fichiers statiques et gère une API de persistance des configurations (fichier `data/configs.json`).

### Déploiement Render (gratuit/Starter)

1. Poussez ce repo sur GitHub (branch `main`).
2. Créez un service Web sur https://render.com :
	 - Repository: ce dépôt
	 - Branch: main
	 - Runtime: Node
	 - Build Command: `npm install`
	 - Start Command: `node server.js`
	 - Environment: `PORT` est fourni par Render automatiquement
3. L’app écoute sur `0.0.0.0:${PORT}` (déjà configuré).
4. Une fois déployé, Render expose une URL publique, par ex. `https://votre-app.onrender.com/`.

### Persistance

- Render utilise un système de fichier éphémère sur les plans gratuits. Pour garder `data/configs.json` entre redéploiements/arrêts, utilisez un disque persistant:
	- Render > votre service > Disks > Add Disk
	- Name: `data`, Mount Path: `/opt/render/project/src/data`, Size: 1GB (ou plus)
	- L’app écrira `data/configs.json` dans ce dossier monté.

### Test

- Ouvrez l’URL Render et utilisez le sélecteur de configuration (Nouveau/Save/Copier/Supprimer). Les données seront persistées côté serveur (fichier `data/configs.json`).

### Remarques

- Sur un hébergement statique (GitHub Pages), la persistance retombe sur localStorage.
- Avec le serveur Node (Render, VPS…), le frontend détecte l’API `/api/configs` et bascule automatiquement en mode persistant.
