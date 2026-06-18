const { supabase } = require('./db.js');
const { mapErrorType } = require('./taxonomy.js');

module.exports = async function handler(req, res) {
  // Activer les CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  const { action } = req.body;

  // ACTION : Sauvegarde de session
  if (action === 'saveSession') {
    const { userId, level, score, history } = req.body;

    if (!userId || !level || score === undefined || !history || !Array.isArray(history)) {
      return res.status(400).json({ error: 'Paramètres manquants pour sauvegarder la session.' });
    }

    try {
      // 1. Créer la session
      const { data: sessionData, error: sessionErr } = await supabase
        .from('sessions')
        .insert([
          {
            user_id: userId,
            level,
            score: parseInt(score, 10)
          }
        ])
        .select();

      if (sessionErr) throw sessionErr;
      const session = sessionData[0];

      // 2. Insérer tous les logs de l'historique
      const logsToInsert = [];
        history.forEach(caseItem => {
        if (caseItem.evaluations && Array.isArray(caseItem.evaluations)) {
          caseItem.evaluations.forEach(ev => {
            if (!ev) return;
            
            const statusVal = ev.status || ev.statut || "INCORRECTE";
            
            // Récupérer le type d'erreur via la taxonomie centralisée
            const errorType = mapErrorType(ev.error_type || ev.errorType, statusVal, ev.comm || ev.commentaire);

            logsToInsert.push({
              session_id: session.id,
              packaging_name: caseItem.packaging,
              student_answer: ev.func || ev.fonction || "",
              evaluation_status: statusVal,
              error_type: errorType,
              ai_comment: ev.comm || ev.commentaire || null,
              ai_suggestion: ev.sugg || ev.suggestion || null
            });
          });
        }
      });

      if (logsToInsert.length > 0) {
        const { error: logsErr } = await supabase
          .from('activity_logs')
          .insert(logsToInsert);
          
        if (logsErr) throw logsErr;
      }

      return res.status(200).json({ success: true, sessionId: session.id });

    } catch (err) {
      console.error('Erreur saveSession:', err.message);
      return res.status(500).json({ error: 'Erreur lors de la sauvegarde de la session.' });
    }
  }

  // ACTION PAR DÉFAUT : Évaluation IA
  const { packaging, answers, level } = req.body;

  if (!packaging || !answers || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'Paramètres manquants : packaging et/ou answers.' });
  }

  const userLevel = level === 'avance' ? 'avance' : 'debutant';

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Clé API non configurée. Veuillez ajouter la variable d'environnement GEMINI_API_KEY."
    });
  }

  const answersText = answers.map((ans, i) => `${i + 1}. ${ans}`).join('\n');

  const systemInstruction = `Tu es un professeur expert en Analyse Fonctionnelle pour des étudiants en Master Packaging à l'ESEPAC.
IMPORTANT : tutoie TOUJOURS l'étudiant. Ne le vouvoie jamais.

Règles de notation selon le niveau de l'étudiant :

NIVEAU DÉBUTANT :
- Indulgence sur l'omission de l'objet : Si l'élève écrit une fonction logique avec verbe d'action + EME mais sans l'objet direct (ex: "Protéger des chocs" au lieu de "Protéger le contenu des chocs"), note-la CORRECTE. Dans le commentaire ("comm"), suggère simplement de préciser l'objet.
- Adverbes subjectifs (bien, facilement, efficacement...) : Note la fonction comme CORRECTE, mais ajoute dans "comm" une remarque pédagogique indiquant qu'il faut éviter ces termes subjectifs pour être plus rigoureux.
- Verbe faible "Permettre de..." : Note la fonction comme CORRECTE, mais suggère dans "comm" de privilégier un verbe d'action direct si possible.
- Écarts méthodologiques de formulation : Pour les écarts décrits ci-dessous (Fonctions valises, Verbes d'action faibles, Marketing subjectif, Action subie), note la fonction comme PARTIELLEMENT CORRECTE. Explique le problème dans "comm" et propose une reformulation dans "sugg".

NIVEAU AVANCÉ :
- Rigueur académique sur l'objet direct : L'absence de l'objet direct (ex: "Protéger des chocs") doit être notée PARTIELLEMENT CORRECTE.
- Adverbes subjectifs (bien, facilement, efficacement...) : Note la fonction comme PARTIELLEMENT CORRECTE. Explique dans "comm" que l'utilisation de termes subjectifs nuit à la rigueur technique du cahier des charges.
- Verbe faible "Permettre de..." : Note la fonction comme PARTIELLEMENT CORRECTE (sauf s'il s'agit d'exprimer une fonction d'usage utilisateur indispensable comme "Permettre à l'utilisateur de..."). Explique dans "comm" qu'il faut utiliser un verbe d'action direct.
- Écarts méthodologiques de formulation : Pour les écarts décrits ci-dessous (Fonctions valises, Verbes d'action faibles, Marketing subjectif, Action subie), note la fonction comme INCORRECTE.

Définition des écarts méthodologiques de formulation :
1. Fonctions "Valises" : Fonctions trop générales sans cible/agresseur extérieur précis (ex: "Protéger le produit" au lieu de "Protéger le produit contre la lumière").
2. Verbes d'action faibles de nominalisation : Verbes généraux servant de support à un nom (ex: "Assurer la conservation" au lieu de "Conserver" ou "Faire barrière", "Garantir l'étanchéité" au lieu de "Empêcher le produit de s'échapper").
3. Marketing subjectif : Utilisation de verbes d'action subjectifs ou psychologiques (ex: "Séduire le client", "Donner envie d'acheter" au lieu de "Valoriser l'image de marque").
4. Action subie vs action active : Formulations passives ou décrivant un mouvement interne mécanique subi par l'emballage (ex: "Être empilé" au lieu de "Supporter l'empilement", "Passer dans la machine" au lieu de "S'adapter au système de guidage").

Règles communes (Débutant & Avancé) :
- TOUJOURS COMPTER FAUX LES TOURNURES NÉGATIVES : Les propositions formulées avec une négation (ex: "Ne pas laisser passer la lumière", "Ne pas fuir") doivent être notées impérativement comme INCORRECTE pour tous les niveaux. Explique dans "comm" qu'une fonction doit toujours s'exprimer de manière positive et active, et suggère une formulation affirmative (ex: "Faire barrière à la lumière", "Empêcher le produit de s'échapper").
- SUJET IMPLICITE DE L'EMBALLAGE (Règle d'or) : Il est STRICTEMENT INTERDIT d'exiger de l'étudiant qu'il mentionne explicitement le mot "emballage" ou "bouteille" ou "système" (ex: NE PAS suggérer "Permettre à l'emballage de supporter..." au lieu de "Supporter..."). Le sujet qui réalise la fonction est implicitement l'emballage. Des formulations comme "Supporter un remplissage à chaud" ou "Contenir le lait" sont entièrement correctes sur ce point.
- EXCEPTION SUR LES COMPOSANTS PHYSIQUES : En règle générale, citer un composant physique de l'emballage lui-même (bouchon, carton, film, opercule...) ou un matériau (PET, verre...) ou un procédé est interdit et noté INCORRECTE. EXCEPTION UNIQUE : Si le nom de l'emballage à analyser (fourni dans le sujet, ex: "Pot de yaourt en polystyrène avec opercule aluminium") contient explicitement un composant ou un matériau, l'étudiant est autorisé à y faire référence dans ses fonctions (ex: citer l'opercule ou le pot).
- FONCTION DE SERVICE (vs Action interne) : La fonction doit décrire un service rendu à un élément du milieu extérieur (utilisateur, produit contenu, logistique) et non une action mécanique interne au système.
- CORRECTE : le fond est logique ET la forme respecte la structure active canonique (verbe d'action à l'infinitif + objet + complément EME).
- INDULGENCE SUR L'ORTHOGRAPHE ET LA GRAMMAIRE : Sois impérativement indulgent avec les fautes d'orthographe mineures, de grammaire ou les oublis légers d'articles (ex: "Rendre visible contenu au consommateur" au lieu de "Rendre visible le contenu au consommateur"). Si le sens technique général reste parfaitement compréhensible, note la fonction comme CORRECTE. Propose simplement la correction linguistique propre dans le champ suggestion ("sugg") et mentionne-le gentiment dans "comm" sans dégrader la note.
- PARTIELLEMENT CORRECTE : le fond est bon mais la forme pose problème (hors fautes d'orthographe/articles légers acceptés ci-dessus), ou inversement.
- INCORRECTE : fond aberrant OU verbe seul sans complément EME OU proposition contenant une solution technique concrète (hors cas de l'exception ci-dessus) OU proposition concernant l'environnement, le recyclage, l'économie ou la fin de vie.
ATTENTION : citer le PRODUIT CONTENU (ex: le gruyère, le lait, le riz, les haricots, le parfum, etc.) ou le terme générique « le contenu » est ENTIÈREMENT CORRECT et attendu.
- Règle des impossibilités physiques ou hors sujet : Si l'étudiant propose une fonction techniquement impossible pour l'emballage donné (ex: "Permettre de voir le contenu" pour une canette en alu opaque) ou complètement hors sujet, note-la INCORRECTE. Explique la contrainte physique ou le problème de pertinence dans "comm". Dans "sugg", mets "Non applicable" ou une reformulation théoriquement correcte.
- Règle des verbes d'état : L'usage des verbes d'état principaux (être, avoir, paraître, sembler, devenir) dans les propositions de l'étudiant doit impérativement être noté comme INCORRECTE.
- Règle Environnement, Fin de vie & Économie : Si l'étudiant parle de fin de vie, de recyclage, de tri, ou cherche à optimiser le coût ou le poids/matière par souci économique ou environnemental (ex: "Minimiser le coût de fabrication", "Réduire le poids de plastique pour la planète"), note-le impérativement comme INCORRECTE. Explique clairement dans "comm" : "Dans un projet packaging global, les aspects fonctionnels, économiques et environnementaux sont traités séparément dans trois matrices distinctes (fonctionnelle, économique et environnementale) puis confrontés. Injecter des critères économiques ou environnementaux dans l'analyse fonctionnelle d'usage fausserait l'analyse globale."
- Champ suggestion ("sugg") : Remplis ce champ si le statut est PARTIELLEMENT CORRECTE ou INCORRECTE, OU s'il y a des corrections orthographiques/grammaticales sur une fonction CORRECTE. Si la fonction est parfaitement CORRECTE sans aucune faute, laisse "sugg" vide (chaîne vide ""). Il doit contenir UNIQUEMENT la proposition de reformulation correcte de la fonction, et JAMAIS de conseils méthodologiques ou de remarques (ces derniers vont exclusivement dans le champ "comm").
- Conseiller : Proposer 2 à 3 fonctions pertinentes manquantes dans "conseils" (hors recyclage/fin de vie/critères économiques).
- Champ "error_type" : Si une fonction est CORRECTE malgré de légères fautes d'orthographe ou d'article, mets "none".

Catégorisation du type d'erreur ("error_type") :
Pour chaque fonction, attribue obligatoirement l'une des valeurs suivantes pour "error_type" :
- "none" : Si la fonction est CORRECTE (y compris avec fautes légères acceptées).
- "rigueur_formulation" : Si la fonction ne commence pas par un verbe d'action à l'infinitif (ou utilise une tournure négative, ou un verbe faible type "Permettre de" au niveau avancé, ou des adverbes subjectifs). Note : les fautes d'orthographe ou d'articles légères ne doivent pas être qualifiées d'erreur de rigueur si le sens est bon.
- "verbe_etat" : Si la fonction contient un verbe d'état principal (être, avoir, paraître, sembler, devenir...).
- "solution_physique" : Si la fonction cite explicitement un composant de l'emballage (hors exception du sujet), un matériau ou un procédé.
- "manque_eme" : Si la fonction omet le complément de milieu extérieur (EME) ou l'objet direct (ou si c'est une fonction valise trop générale).
- "hors_cadre_usage" : Si la fonction mentionne le tri, recyclage, fin de vie, ACV, éco-conception ou des aspects d'optimisation économique/poids de matière.
- "hors_sujet" : Si la fonction est techniquement irréalisable/incompatible avec le produit ou totalement déconnectée du sujet (ou si c'est une action mécanique ou passive subie par le système).
- "autre_incorrect" : Toute autre erreur de sens ou de formulation n'entrant pas dans les catégories précédentes.

CONSIGNE DE CONCISION STRICTE : Fais des commentaires d'évaluation très courts, d'au maximum 1 à 2 phrases par fonction. Va droit au but.`;

  const prompt = `Sujet : ${packaging}
Niveau de l'exercice : ${userLevel === 'debutant' ? 'Débutant (Rappels de règles simples)' : 'Avancé (Perspectives : Conservation, Logistique, Usage, Information)'}

Fonctions formulées par l'étudiant :
${answersText}`;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      evals: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            func: { type: "STRING" },
            status: { type: "STRING", enum: ["CORRECTE", "PARTIELLEMENT CORRECTE", "INCORRECTE"] },
            error_type: { 
              type: "STRING", 
              enum: ["none", "rigueur_formulation", "verbe_etat", "solution_physique", "manque_eme", "hors_cadre_usage", "hors_sujet", "autre_incorrect"] 
            },
            comm: { type: "STRING" },
            sugg: { type: "STRING" }
          },
          required: ["func", "status", "error_type", "comm", "sugg"]
        }
      },
      bilan: { type: "STRING" },
      conseils: {
        type: "ARRAY",
        items: { type: "STRING" }
      }
    },
    required: ["evals", "bilan", "conseils"]
  };

  const models = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }]
            },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
              responseSchema: responseSchema
            }
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Erreur de statut API Gemini : ${response.status}`);
      }

      const responseData = await response.json();
      const rawText = responseData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      const cleanedText = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      const parsedJSON = JSON.parse(cleanedText);
      return res.status(200).json(parsedJSON);

    } catch (err) {
      console.warn(`Échec de l'appel avec le modèle ${model} :`, err.message);
      lastError = err;
    }
  }

  return res.status(502).json({
    error: `Impossible d'obtenir une réponse de Gemini. Dernière erreur : ${lastError?.message || 'Inconnue'}`
  });
};
