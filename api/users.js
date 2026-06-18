const { supabase } = require('./db.js');
const { mapErrorType } = require('./taxonomy.js');

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Récupère la liste des étudiants classés
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, firstname, class')
        .eq('role', 'student')
        .order('class', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      return res.status(200).json(data || []);
    } catch (err) {
      console.error('Erreur GET /api/users:', err.message);
      return res.status(500).json({ error: 'Erreur lors de la récupération des étudiants.' });
    }
  }

  // POST: Connexion
  if (req.method === 'POST') {
    const { action, userId, password } = req.body;

    if (action === 'login') {
      if (!userId || !password) {
        return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
      }

      try {
        const { data: user, error } = await supabase
          .from('users')
          .select('id, name, firstname, class, password, role')
          .eq('id', userId)
          .single();

        if (error || !user) {
          return res.status(404).json({ error: 'Utilisateur non trouvé.' });
        }

        // Vérification simple du mot de passe (en clair pour simplicité demandée)
        if (user.password !== password) {
          return res.status(401).json({ error: 'Mot de passe incorrect.' });
        }

        // Retourne les infos utilisateur sans le mot de passe
        return res.status(200).json({
          id: user.id,
          name: user.name,
          firstname: user.firstname,
          class: user.class,
          role: user.role
        });
      } catch (err) {
        console.error('Erreur POST /api/users (login):', err.message);
        return res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
      }
    }

    if (action === 'studentDashboard') {
      if (!userId) {
        return res.status(400).json({ error: 'Identifiant requis.' });
      }

      try {
        // 1. Récupérer les infos de l'étudiant ciblé
        const { data: currentUser, error: userErr } = await supabase
          .from('users')
          .select('id, name, firstname, class')
          .eq('id', userId)
          .single();

        if (userErr || !currentUser) {
          return res.status(404).json({ error: 'Utilisateur non trouvé.' });
        }

        // 2. Récupérer tous les étudiants de la même classe
        const { data: classmates, error: classErr } = await supabase
          .from('users')
          .select('id, name, firstname, class')
          .eq('class', currentUser.class)
          .eq('role', 'student');

        if (classErr) throw classErr;

        const classmateIds = classmates.map(c => c.id);

        // 3. Récupérer toutes les sessions des membres de la classe
        const { data: classSessions, error: sessionsErr } = await supabase
          .from('sessions')
          .select('*')
          .in('user_id', classmateIds);

        if (sessionsErr) throw sessionsErr;

        // 4. Récupérer tous les logs pour les sessions des membres de la classe (nécessaire pour calculer les % et erreurs)
        const sessionIds = classSessions.map(cs => cs.id);
        let allLogs = [];
        if (sessionIds.length > 0) {
          const { data: logsData, error: logsErr } = await supabase
            .from('activity_logs')
            .select('session_id, evaluation_status, error_type')
            .in('session_id', sessionIds);
          if (logsErr) throw logsErr;
          allLogs = logsData || [];
        }

        // Calculer le classement de la classe (Top score par étudiant)
        const rankingList = classmates.map(student => {
          const studentSessions = classSessions.filter(s => s.user_id === student.id);
          const maxScore = studentSessions.length ? Math.max(...studentSessions.map(s => s.score)) : 0;
          return {
            id: student.id,
            firstname: student.firstname,
            lastnameLetter: student.name ? student.name.charAt(0).toUpperCase() + '.' : '',
            maxScore: maxScore,
            sessionsCount: studentSessions.length
          };
        }).sort((a, b) => b.maxScore - a.maxScore);

        // Historique de progression personnel de l'étudiant
        // Tri dynamique : par created_at si présent, sinon par id auto-incrémenté
        const personalSessions = classSessions.filter(s => s.user_id === userId)
          .sort((a, b) => {
            const dateA = a.created_at || a.created || a.date;
            const dateB = b.created_at || b.created || b.date;
            if (dateA && dateB) {
              return new Date(dateA) - new Date(dateB);
            }
            return a.id - b.id; // Fallback chronologique ID
          });

        const history = personalSessions.map(session => {
          const sessionLogs = allLogs.filter(l => l.session_id === session.id);
          const totalFuncs = sessionLogs.length;
          const correctFuncs = sessionLogs.filter(l => l.evaluation_status === 'CORRECTE').length;
          const percentageCorrect = totalFuncs > 0 ? Math.round((correctFuncs / totalFuncs) * 100) : 0;

          return {
            id: session.id,
            score: session.score,
            level: session.level,
            date: session.created_at || session.created || session.date || null,
            percentageCorrect: percentageCorrect
          };
        });

        // Cumul personnel des types d'erreurs pour la vigilance
        const personalSessionIds = personalSessions.map(s => s.id);
        const personalLogs = allLogs.filter(l => personalSessionIds.includes(l.session_id));

        const errorsSummary = {
          rigueur_formulation: 0,
          verbe_etat: 0,
          solution_physique: 0,
          manque_eme: 0,
          hors_cadre_usage: 0,
          hors_sujet: 0,
          autre_incorrect: 0
        };

        personalLogs.forEach(log => {
          if (log.evaluation_status !== 'CORRECTE') {
            const type = mapErrorType(log.error_type, log.evaluation_status, null) || 'autre_incorrect';

            if (errorsSummary[type] !== undefined) {
              errorsSummary[type]++;
            } else {
              errorsSummary.autre_incorrect++;
            }
          }
        });

        return res.status(200).json({
          user: {
            id: currentUser.id,
            firstname: currentUser.firstname,
            name: currentUser.name,
            class: currentUser.class
          },
          ranking: rankingList,
          history: history,
          errorsSummary: errorsSummary
        });

      } catch (err) {
        console.error('Erreur studentDashboard:', err.message);
        return res.status(500).json({ error: 'Erreur lors du chargement des données du tableau de bord : ' + err.message });
      }
    }

    return res.status(400).json({ error: 'Action non reconnue.' });
  }

  return res.status(405).json({ error: 'Méthode non autorisée.' });
}
