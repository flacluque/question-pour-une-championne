// Réglages du site (voir README.md).
// La clé "anon" est faite pour être publique : la sécurité vient des règles du fichier supabase/schema.sql.
window.QUIZ_CONFIG = {
  supabaseUrl: "https://plysqkysxzfzysjggxtp.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBseXNxa3lzeHpmenlzamdneHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3MDY4MzAsImV4cCI6MjExMTI4MjgzMH0.njpVEWxp09P8HjqbmTy3RMxXUHBXmZd6a-sJ2zC0vTQ",

  // Les comptes admin, créés dans Supabase > Authentication > Users.
  // "name" s'affiche sur l'écran de connexion ; le code d'accès est le mot de passe du compte.
  // Chaque admin ne voit et ne modifie que ses propres quiz.
  admins: [
    { name: "Moi", email: "admin@question-pour-une-championne.fr" },
    // Pour un deuxième admin, crée son compte dans Supabase puis retire les // :
    // { name: "Elle", email: "elle@question-pour-une-championne.fr" },
  ],
};
