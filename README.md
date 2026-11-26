# Question pour une championne

Un petit quiz à choix multiples (4 réponses) sur moi. Chaque bonne réponse affiche une photo.
Un espace admin, protégé par un code, permet d'ajouter, modifier, réordonner et supprimer les questions et leurs photos.

- **Site** : HTML/CSS/JS statique, hébergé sur Vercel
- **Données et photos** : [Supabase](https://supabase.com) (offre gratuite)

```
index.html          page unique (quiz + admin)
style.css
app.js
config.js           adresse et clé Supabase à remplir
supabase/schema.sql tables, règles de sécurité et bucket photos
```

## Mise en place (une seule fois, ~10 min)

### 1. Créer le projet Supabase

1. Crée un compte sur supabase.com puis un **New project** (région Europe, mot de passe de base de données au choix).
2. Ouvre **SQL Editor → New query**, colle tout le contenu de `supabase/schema.sql` et clique sur **Run**.

### 2. Créer le compte admin (= le code d'accès)

1. **Authentication → Users → Add user → Create new user**.
2. E-mail : celui que tu mets dans `config.js` (`adminEmail`). Il n'a pas besoin d'exister vraiment.
3. Mot de passe : **c'est le code d'accès de l'espace admin** (6 caractères minimum).
4. Coche **Auto Confirm User**.
5. Puis **Authentication → Sign In / Providers** (ou *Settings*) : désactive **Allow new users to sign up**, pour que personne d'autre ne puisse créer de compte.

### 3. Brancher le site

Dans Supabase, **Project Settings → API** (ou *Data API*) : copie le **Project URL** et la clé **anon public**, puis colle-les dans `config.js`.

La clé `anon` est faite pour être publique. Elle permet seulement de lire les questions et les photos : les règles de `schema.sql` réservent l'écriture au compte admin connecté.

### 4. Publier sur Vercel

1. Sur vercel.com, connecte-toi avec GitHub puis **Add New… → Project**.
2. Importe le repo `flacluque/question-pour-une-championne`.
3. **Framework Preset : Other**. Laisse vides la commande de build et le dossier de sortie : le site n'a rien à compiler.
4. Clique sur **Deploy**. Le site est en ligne en quelques secondes, à une adresse du type `https://question-pour-une-championne.vercel.app`.

Ensuite, chaque `git push` sur `main` redéploie le site automatiquement.

## Utilisation

- Le quiz s'ouvre directement sur la page.
- **Espace admin** (lien en bas de page) : entre le code, puis ajoute tes questions. Coche la bonne réponse et choisis une photo. Les grosses photos sont réduites automatiquement avant l'envoi.
- Tu peux changer le code depuis le dashboard.

## Tester en local

```bash
python3 -m http.server 8000
```

Puis ouvre http://localhost:8000.
