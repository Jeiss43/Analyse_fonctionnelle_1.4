# Entraînement à l'Analyse Fonctionnelle — Version 1.2

Cette version 1.2 intègre une base de données **Supabase** gratuite pour l'authentification des étudiants, l'import CSV et le suivi pédagogique individuel et collectif (méta-analyse des erreurs).

Voici le guide pas-à-pas complet pour configurer et lancer le projet pour la première fois.

---

## Étape 1 : Créer votre Base de Données Gratuite sur Supabase

1. Rendez-vous sur [https://supabase.com/](https://supabase.com/) et créez un compte gratuit.
2. Une fois connecté, cliquez sur **New Project** (Nouveau projet).
3. Remplissez les informations suivantes :
   *   **Name** : `Analyse-Fonctionnelle` (ou le nom de votre choix)
   *   **Database Password** : Choisissez un mot de passe solide (notez-le de côté).
   *   **Region** : Choisissez la région la plus proche (ex: *Europe (Frankfurt)*).
   *   **Pricing Plan** : Sélectionnez le plan **Free** (Gratuit).
4. Cliquez sur **Create new project**. La création prend environ 1 à 2 minutes.

---

## Étape 2 : Créer les Tables de Données

Une fois le projet prêt sur Supabase :
1. Dans le menu de gauche, cliquez sur **SQL Editor** (l'icône avec un symbole de terminal `>_`).
2. Cliquez sur **New Query** (Nouvelle requête).
3. Copiez et collez le script SQL ci-dessous dans la zone de texte :

```sql
-- 1. Table des utilisateurs (étudiants et admins)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    firstname TEXT NOT NULL,
    class TEXT NOT NULL,
    password TEXT NOT NULL, -- Mot de passe simple stocké en clair pour cet entraînement
    role TEXT NOT NULL DEFAULT 'student',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Table des sessions de jeu
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    level TEXT NOT NULL, -- 'debutant' / 'avance'
    score INTEGER NOT NULL
);

-- 3. Table détaillée de l'activité (pour méta-analyse et erreurs)
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    packaging_name TEXT NOT NULL,
    student_answer TEXT NOT NULL,
    evaluation_status TEXT NOT NULL, -- 'CORRECTE', 'PARTIELLEMENT CORRECTE', 'INCORRECTE'
    error_type TEXT, -- 'verbe_etat', 'solution_physique', 'formule_incorrecte', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

4. Cliquez sur le bouton **Run** en bas à droite pour exécuter la requête. Les tables sont maintenant créées et prêtes à être utilisées.

---

## Étape 3 : Récupérer vos Clés de Connexion Supabase

1. Dans le menu de gauche de Supabase, cliquez sur **Project Settings** (l'icône d'engrenage tout en bas).
2. Cliquez sur l'onglet **API**.
3. Vous y trouverez deux valeurs importantes :
   *   **Project API URL** (ressemble à `https://xxxxxx.supabase.co`)
   *   **anon (public) Key** (une très longue clé de sécurité)
4. Gardez cette page ouverte ou copiez ces valeurs.

---

## Étape 4 : Configurer le Fichier d'Environnement Local

Pour faire tourner le projet sur votre ordinateur :
1. Ouvrez le dossier `Analyse_fonctionnelle_1.2` avec votre éditeur de code.
2. Créez un nouveau fichier nommé `.env` à la racine de ce dossier.
3. Remplissez-le avec le modèle suivant en remplaçant par vos propres valeurs :

```env
# Clé d'accès à l'API d'Intelligence Artificielle Google Gemini
GEMINI_API_KEY="VOTRE_CLE_API_GEMINI"

# Vos clés d'accès Supabase récupérées à l'Étape 3
SUPABASE_URL="https://xxxxxx.supabase.co"
SUPABASE_ANON_KEY="VOTRE_CLE_ANON_PUBLIQUE_SUPABASE"

# Le mot de passe de connexion de l'espace Enseignant (admin)
ADMIN_PASSWORD="votre-mot-de-passe-enseignant"
```

---

## Étape 5 : Lancer le Projet Localement

1. Assurez-vous d'avoir installé [Node.js](https://nodejs.org/) sur votre ordinateur.
2. Ouvrez une invite de commandes ou un terminal dans le dossier `Analyse_fonctionnelle_1.2`.
3. Installez le client Vercel pour tester les API locales si ce n'est pas déjà fait :
   ```bash
   npm install -g vercel
   ```
4. Installez les dépendances du projet :
   ```bash
   npm install
   ```
5. Lancez le serveur local de test :
   ```bash
   vercel dev
   ```
6. Ouvrez votre navigateur sur l'adresse indiquée (généralement `http://localhost:3000`).

---

## Étape 6 : Déployer en Ligne Gratuitement sur Vercel

Pour que vos étudiants puissent y accéder partout sur Internet :
1. Créez un projet sur **GitHub** et poussez-y votre dossier `Analyse_fonctionnelle_1.2`.
2. Connectez-vous sur votre compte [Vercel](https://vercel.com/) et cliquez sur **Add New Project**.
3. Importez votre dépôt GitHub.
4. Avant de cliquer sur **Deploy**, ouvrez la section **Environment Variables** et ajoutez les 4 variables définies à l'étape 4 :
   *   `GEMINI_API_KEY`
   *   `SUPABASE_URL`
   *   `SUPABASE_ANON_KEY`
   *   `ADMIN_PASSWORD`
5. Cliquez sur **Deploy**. Votre application est en ligne !

---

## Étape 7 : Importer vos Premiers Étudiants

1. Rendez-vous sur votre site en ligne et cliquez sur **⚙️ Accès Enseignant / Administration** sur l'écran d'accueil.
2. Connectez-vous avec votre `ADMIN_PASSWORD`.
3. Allez dans l'onglet **Gestion & Import CSV** :
   *   Vous pouvez ajouter des élèves individuellement.
   *   Ou importer un fichier CSV d'un coup (au format : `Nom,Prénom,Classe,MotDePasse`).
4. Vos élèves peuvent ensuite retourner sur l'écran d'accueil, choisir leur classe et leur nom dans les listes déroulantes pour commencer à s'entraîner !
