# Gestion de l'institut

Petit logiciel de suivi pour un institut de beauté : entrées et sorties d'argent, justificatifs en photo, stock simple, rapport mensuel imprimable.

**Technique :** HTML / CSS / JavaScript sans build, [Supabase](https://supabase.com) (base, login, photos), Netlify (hébergement du site). Tout est sur des offres gratuites.

## Mise en route (démo ou version finale)

1. **Supabase** : créer un projet (région Zurich si possible).
2. **SQL Editor** : coller le contenu de `schema.sql` et cliquer *Run*.
3. **Authentication > Users** : *Add user* (e-mail + mot de passe, cocher « Auto Confirm »).
4. **Authentication > Sign In / Providers** : désactiver *Allow new users to sign up*. Sans ça, n'importe qui pourrait créer un compte.
5. **Demo uniquement** : coller `seed-demo.sql` dans le SQL Editor et lancer. **Jamais sur la base réelle.**
6. **`config.js`** : mettre l'URL du projet et la clé *publishable* (Project Settings > API Keys). Mettre aussi le nom de l'institut.
7. **Netlify** : *Add new site > Import from Git*, choisir ce dépôt. Pas de commande de build, dossier de publication = racine (`/`).

## Passer de la démo à la version de l'institut

1. L'institut crée ses comptes GitHub, Supabase et Netlify (gratuits).
2. Refaire les étapes 1 à 4 et 6 sur son projet Supabase (sans `seed-demo.sql`).
3. Modifier les deux lignes de `config.js`, pousser sur son dépôt, relier Netlify.

## Notes

- **Pause Supabase** : le plan gratuit met un projet en pause après 7 jours sans activité. `.github/workflows/ping.yml` fait un appel deux fois par semaine pour l'éviter. GitHub désactive pourtant les workflows planifiés après 60 jours sans aucune activité sur le dépôt : utiliser l'app régulièrement suffit aussi, et on peut relancer le workflow à la main (onglet *Actions*).
- **Sauvegarde** : pas de sauvegarde automatique sur le plan gratuit. Le bouton « Sauvegarde complète » (tableau de bord) télécharge tout en ZIP (CSV + justificatifs). À faire de temps en temps, et à garder 10 ans pour la comptabilité.
- **Mot de passe oublié** : à réinitialiser depuis Supabase (*Authentication > Users*).

## Fichiers

| Fichier | Rôle |
|---|---|
| `schema.sql` | Tables, règles de cohérence, sécurité, stockage des photos |
| `seed-demo.sql` | Fausses données pour la démo |
| `config.js` | URL / clé Supabase, nom de l'institut |
| `index.html`, `css/`, `js/` | L'application |
