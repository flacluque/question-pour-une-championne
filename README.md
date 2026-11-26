# Question pour une championne

Des quiz à choix multiples (4 réponses). Chaque bonne réponse affiche une photo.
On choisit son quiz sur la page d'accueil. Chaque admin a son espace, protégé par un code, où il crée ses quiz, les publie quand ils sont prêts, et gère les questions et les photos.

- **Site** : HTML/CSS/JS statique, hébergé sur Vercel
- **Données et photos** : [Supabase](https://supabase.com) (offre gratuite)

```
index.html          page unique (liste des quiz, partie, admin)
style.css
app.js
config.js           adresse et clé Supabase, joueurs (nom, tête, compte admin)
fx.js               sons (générés dans le navigateur) et confettis
img/                têtes détourées
supabase/schema.sql tables (quiz, questions), règles de sécurité, bucket photos
```

## Mise en place (une seule fois, ~10 min)

### 1. Créer le projet Supabase

1. Crée un compte sur supabase.com puis un **New project** (région Europe, mot de passe de base de données au choix).
2. Ouvre **SQL Editor → New query**, colle tout le contenu de `supabase/schema.sql` et clique sur **Run**.

### 2. Créer le compte admin (= le code d'accès)

1. **Authentication → Users → Add user → Create new user**.
2. E-mail : celui que tu mets dans la liste `people` de `config.js`. Il n'a pas besoin d'exister vraiment.
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

- La page d'accueil liste les quiz publiés. On en choisit un pour jouer. Chaque quiz a aussi son propre lien (bouton **Copier le lien** dans l'admin).
- **Espace admin** (lien en bas de page) : choisis qui tu es, entre ton code, puis :
  - crée un quiz (titre et description) ; il démarre en **brouillon**, visible seulement par toi ;
  - ajoute les questions : coche la bonne réponse et choisis une photo (les grosses photos sont réduites avant l'envoi) ;
  - coche **Publié** quand il est prêt pour qu'il apparaisse sur l'accueil.
- Chaque admin ne voit et ne modifie que ses propres quiz. Supprimer un quiz supprime aussi ses questions et ses photos.
- Chacun peut changer son code depuis son espace admin.

## Ajouter un deuxième admin

1. Dans Supabase, **Authentication → Users → Add user → Create new user**, avec un autre e-mail (inventé si tu veux), son code comme mot de passe, et **Auto Confirm User** coché.
2. Dans `config.js`, complète sa ligne dans `people` : son `email`, et son `id` (le **User UID** affiché dans Supabase > Authentication > Users) pour que sa tête apparaisse sur ses quiz.
3. Pousse sur GitHub : Vercel redéploie, et l'écran de connexion propose de choisir entre les deux.

## Mise à jour depuis la version à un seul quiz

Relance tout `supabase/schema.sql` dans le SQL Editor. Le script crée la table des quiz, range les questions existantes dans un premier quiz publié (« Est-ce que tu me connais vraiment ? ») attribué au premier compte admin, et met à jour les règles.

## Tester en local

```bash
python3 -m http.server 8000
```

Puis ouvre http://localhost:8000.
