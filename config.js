// Réglages du site (voir README.md).
// La clé "anon" est faite pour être publique : la sécurité vient des règles du fichier supabase/schema.sql.
window.QUIZ_CONFIG = {
  supabaseUrl: "https://plysqkysxzfzysjggxtp.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBseXNxa3lzeHpmenlzamdneHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3MDY4MzAsImV4cCI6MjExMTI4MjgzMH0.njpVEWxp09P8HjqbmTy3RMxXUHBXmZd6a-sJ2zC0vTQ",

  // Les joueurs du site.
  // - name : affiché sur l'écran de connexion et dans les bulles
  // - head : la tête détourée (PNG transparent dans img/)
  // - email : le compte admin créé dans Supabase > Authentication > Users ("" = pas encore d'espace admin)
  //   Le code d'accès est le mot de passe de ce compte. Chacun ne voit et ne modifie que ses quiz.
  // - id : le "User UID" de ce compte dans Supabase, pour afficher sa tête sur ses quiz
  // - lines : les phrases que dit sa tête quand on clique dessus sur l'accueil
  people: [
    {
      name: "Lui", head: "img/lui.png", email: "admin@question-pour-une-championne.fr", id: "dd22ed40-8aea-4207-9fae-94225c83249b",
      lines: [
        "Prête la peste ?",
        "Gnegnegne je suis le plus fort",
        "On va voir si tu m'écoutes quand je parle",
        "Tié un monstroooo",
        "Allez le sang c'est quand tu veux",
      ],
    },
    {
      name: "Elle", head: "img/elle.png", email: "", id: "",
      lines: [
        "Gnegnegne je suis la plus forte",
        "Prêt fdp ?",
        "Je suis une pute je perds.",
        "Allez c'est quand tu veux",
      ],
    },
  ],
};
