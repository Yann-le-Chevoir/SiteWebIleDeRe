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

## Persistance via Google Drive (recommandé)

Vous pouvez connecter Google Drive pour enregistrer/charger les configurations (JSON) dans un dossier personnel.

Configuration:

1. Créez un projet Google Cloud Console, activez l’API Google Drive.
2. Créez des identifiants OAuth client (type Web).
3. Ajoutez votre URL (ex: `http://127.0.0.1:5500/` en local) aux URIs autorisés.
4. Éditez `gdrive.config.json` et renseignez `clientId`. Optionnel: `folderName`.
5. Rechargez la page et cliquez sur “Google Drive: Connexion”.

Détails:

- Les configs sont des fichiers JSON dans le dossier Google Drive (par défaut `SimulateurMaison`).
- Le sélecteur bascule sur Drive une fois connecté (Nouveau/Save/Copier/Supprimer).
- Déconnexion: bouton “Déconnexion”.

Sécurité (repo public):

- N’exposez pas de secrets dans le repo. L’auth OAuth suffit pour Drive; aucune clé d’API n’est requise.
- Vous pouvez garder un `gdrive.config.json` local non versionné (ajoutez-le à `.gitignore`) et fournir un autre fichier pour la prod via un hébergement séparé (ou remplir la config dynamiquement).

Note: l’ancienne persistance serveur est supprimée.
