const { supabase } = require('./db.js');
const { mapErrorType } = require('./taxonomy.js');

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Vérification de l'authentification Admin
  const adminPassword = process.env.ADMIN_PASSWORD || 'esepac-admin';
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.split(' ')[1] : req.body.adminPassword;

  if (token !== adminPassword) {
    return res.status(401).json({ error: 'Mot de passe administrateur incorrect.' });
  }

  // GET: Récupère les statistiques (Méta-analyse & Individuel)
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      // 1. Infos de base sur les utilisateurs
      const { data: users, error: usersErr } = await supabase
        .from('users')
        .select('id, name, firstname, "class", role')
        .eq('role', 'student');

      if (usersErr) throw usersErr;

      // 2. Toutes les sessions (colonnes minimales pour agrégation)
      const { data: sessions, error: sessErr } = await supabase
        .from('sessions')
        .select('id, user_id, score');

      if (sessErr) throw sessErr;

      // 3. Tous les logs d'activité (sans les commentaires/suggestions/réponses de l'IA pour alléger le payload)
      const { data: logs, error: logsErr } = await supabase
        .from('activity_logs')
        .select('session_id, evaluation_status, error_type');

      if (logsErr) throw logsErr;

      // Méta-analyse globale
      const globalStats = {
        totalStudents: users.length,
        totalSessions: sessions.length,
        averageScore: sessions.length ? Math.round(sessions.reduce((acc, s) => acc + s.score, 0) / sessions.length) : 0,
        errors: {
          verbe_etat: 0,
          rigueur_formulation: 0,
          solution_physique: 0,
          manque_eme: 0,
          hors_cadre_usage: 0,
          hors_sujet: 0,
          autre_incorrect: 0
        },
        evaluations: {
          CORRECTE: 0,
          'PARTIELLEMENT CORRECTE': 0,
          INCORRECTE: 0
        }
      };

      logs.forEach(log => {
        if (globalStats.evaluations[log.evaluation_status] !== undefined) {
          globalStats.evaluations[log.evaluation_status]++;
        }
        if (log.evaluation_status !== 'CORRECTE') {
          const type = mapErrorType(log.error_type, log.evaluation_status, null) || 'autre_incorrect';
          if (globalStats.errors[type] !== undefined) {
            globalStats.errors[type]++;
          } else {
            globalStats.errors.autre_incorrect++;
          }
        }
      });

      // Statistiques individuelles
      const studentStats = users.map(user => {
        const userSessions = sessions.filter(s => s.user_id === user.id);
        const userLogs = logs.filter(l => userSessions.map(us => us.id).includes(l.session_id));

        const userErrors = {
          verbe_etat: 0,
          rigueur_formulation: 0,
          solution_physique: 0,
          manque_eme: 0,
          hors_cadre_usage: 0,
          hors_sujet: 0,
          autre_incorrect: 0
        };

        const userEvaluations = {
          CORRECTE: 0,
          'PARTIELLEMENT CORRECTE': 0,
          INCORRECTE: 0
        };

        userLogs.forEach(log => {
          if (userEvaluations[log.evaluation_status] !== undefined) {
            userEvaluations[log.evaluation_status]++;
          }
          if (log.evaluation_status !== 'CORRECTE') {
            const type = mapErrorType(log.error_type, log.evaluation_status, null) || 'autre_incorrect';
            if (userErrors[type] !== undefined) {
              userErrors[type]++;
            } else {
              userErrors.autre_incorrect++;
            }
          }
        });

        const maxScore = userSessions.length ? Math.max(...userSessions.map(s => s.score)) : 0;
        const avgScore = userSessions.length ? Math.round(userSessions.reduce((acc, s) => acc + s.score, 0) / userSessions.length) : 0;

        return {
          id: user.id,
          name: user.name,
          firstname: user.firstname,
          class: user.class,
          sessionsCount: userSessions.length,
          maxScore,
          avgScore,
          errors: userErrors,
          evaluations: userEvaluations
        };
      });

      return res.status(200).json({ globalStats, studentStats });

    } catch (err) {
      console.error('Erreur GET /api/admin:', err.message);
      return res.status(500).json({ error: 'Erreur lors de la génération des statistiques.' });
    }
  }

  // POST: Gestion des utilisateurs (Ajout & Import CSV)
  if (req.method === 'POST') {
    const { action } = req.body;

    if (action === 'getStudentDetails') {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: 'ID de l\'étudiant requis.' });
      }

      try {
        // 1. Récupérer les sessions de l'étudiant
        const { data: sessions, error: sessErr } = await supabase
          .from('sessions')
          .select('id, level, score, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (sessErr) throw sessErr;

        let logs = [];
        if (sessions && sessions.length > 0) {
          const sessionIds = sessions.map(s => s.id);
          const { data: logsData, error: logsErr } = await supabase
            .from('activity_logs')
            .select('session_id, packaging_name, student_answer, evaluation_status, error_type, ai_comment, ai_suggestion')
            .in('session_id', sessionIds);

          if (logsErr) throw logsErr;
          logs = logsData;
        }

        return res.status(200).json({ sessions, logs });
      } catch (err) {
        console.error('Erreur getStudentDetails:', err.message);
        return res.status(500).json({ error: 'Erreur lors de la récupération du détail de l\'étudiant.' });
      }
    }

    if (action === 'addUser') {
      const { name, firstname, className, password } = req.body;
      if (!name || !firstname || !className || !password) {
        return res.status(400).json({ error: 'Tous les champs sont requis.' });
      }

      try {
        const { data, error } = await supabase
          .from('users')
          .insert([
            {
              name,
              firstname,
              class: className,
              password,
              role: 'student'
            }
          ])
          .select();

        if (error) throw error;
        return res.status(201).json(data[0]);
      } catch (err) {
        console.error('Erreur addUser:', err.message);
        return res.status(500).json({ error: 'Erreur lors de la création de l\'étudiant.' });
      }
    }

    if (action === 'importCSV') {
      const { users } = req.body;
      if (!users || !Array.isArray(users)) {
        return res.status(400).json({ error: 'Données utilisateurs requises sous forme de liste.' });
      }

      try {
        const usersToInsert = users.map(u => ({
          name: (u.name || '').trim(),
          firstname: (u.firstname || '').trim(),
          class: (u.class || u.className || '').trim(),
          password: (u.password || '').trim() || `${(u.firstname || 'esepac').trim().toLowerCase()}${Math.floor(100 + Math.random() * 900)}`,
          role: 'student'
        })).filter(u => u.name && u.firstname && u.class);

        if (usersToInsert.length === 0) {
          return res.status(400).json({ error: 'Aucun utilisateur valide à insérer.' });
        }

        const { data, error } = await supabase
          .from('users')
          .insert(usersToInsert)
          .select();

        if (error) throw error;
        return res.status(201).json({ count: data.length, message: `${data.length} utilisateurs importés avec succès.` });
      } catch (err) {
        console.error('Erreur importCSV:', err.message);
        return res.status(500).json({ error: 'Erreur lors de l\'importation des étudiants.' });
      }
    }

    if (action === 'deleteUser') {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: 'ID de l\'étudiant requis.' });
      }

      try {
        // Supprimer d'abord les activity_logs associés aux sessions de cet utilisateur
        const { data: userSessions } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', userId);

        if (userSessions && userSessions.length > 0) {
          const sessionIds = userSessions.map(s => s.id);
          await supabase
            .from('activity_logs')
            .delete()
            .in('session_id', sessionIds);

          // Supprimer ensuite les sessions
          await supabase
            .from('sessions')
            .delete()
            .in('id', sessionIds);
        }

        // Enfin, supprimer l'utilisateur lui-même
        const { error } = await supabase
          .from('users')
          .delete()
          .eq('id', userId);

        if (error) throw error;
        return res.status(200).json({ success: true, message: 'Étudiant et ses données de session supprimés.' });
      } catch (err) {
        console.error('Erreur deleteUser:', err.message);
        return res.status(500).json({ error: 'Erreur lors de la suppression de l\'étudiant.' });
      }
    }

    if (action === 'clearStudentSessions') {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: 'ID de l\'étudiant requis.' });
      }

      try {
        const { data: userSessions } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', userId);

        if (userSessions && userSessions.length > 0) {
          const sessionIds = userSessions.map(s => s.id);
          await supabase
            .from('activity_logs')
            .delete()
            .in('session_id', sessionIds);

          await supabase
            .from('sessions')
            .delete()
            .in('id', sessionIds);
        }

        return res.status(200).json({ success: true, message: 'Données de session de l\'étudiant effacées.' });
      } catch (err) {
        console.error('Erreur clearStudentSessions:', err.message);
        return res.status(500).json({ error: 'Erreur lors de la réinitialisation des sessions de l\'étudiant.' });
      }
    }

    if (action === 'clearClassSessions') {
      const { className } = req.body;
      if (!className) {
        return res.status(400).json({ error: 'Nom de la classe requis.' });
      }

      try {
        const { data: usersInClass, error: usersErr } = await supabase
          .from('users')
          .select('id')
          .eq('"class"', className)
          .eq('role', 'student');

        if (usersErr) throw usersErr;

        if (usersInClass && usersInClass.length > 0) {
          const userIds = usersInClass.map(u => u.id);

          const { data: classSessions } = await supabase
            .from('sessions')
            .select('id')
            .in('user_id', userIds);

          if (classSessions && classSessions.length > 0) {
            const sessionIds = classSessions.map(s => s.id);
            await supabase
              .from('activity_logs')
              .delete()
              .in('session_id', sessionIds);
            await supabase
              .from('sessions')
              .delete()
              .in('id', sessionIds);
          }
        }

        return res.status(200).json({ success: true, message: `Sessions de la classe "${className}" effacées.` });
      } catch (err) {
        console.error('Erreur clearClassSessions:', err.message);
        return res.status(500).json({ error: 'Erreur lors de la réinitialisation des sessions de la classe.' });
      }
    }

    if (action === 'deleteClass') {
      const { className } = req.body;
      if (!className) {
        return res.status(400).json({ error: 'Nom de la classe requis.' });
      }

      try {
        // Trouver tous les étudiants de la classe
        const { data: usersInClass, error: usersErr } = await supabase
          .from('users')
          .select('id')
          .eq('"class"', className)
          .eq('role', 'student');

        if (usersErr) throw usersErr;

        if (usersInClass && usersInClass.length > 0) {
          const userIds = usersInClass.map(u => u.id);

          // Trouver les sessions pour ces utilisateurs
          const { data: classSessions } = await supabase
            .from('sessions')
            .select('id')
            .in('user_id', userIds);

          if (classSessions && classSessions.length > 0) {
            const sessionIds = classSessions.map(s => s.id);
            // Supprimer les logs
            await supabase
              .from('activity_logs')
              .delete()
              .in('session_id', sessionIds);
            // Supprimer les sessions
            await supabase
              .from('sessions')
              .delete()
              .in('id', sessionIds);
          }

          // Supprimer les utilisateurs
          const { error: deleteUsersErr } = await supabase
            .from('users')
            .delete()
            .in('id', userIds);

          if (deleteUsersErr) throw deleteUsersErr;
        }

        return res.status(200).json({ success: true, message: `Classe "${className}" et toutes les données associées supprimées.` });
      } catch (err) {
        console.error('Erreur deleteClass:', err.message);
        return res.status(500).json({ error: 'Erreur lors de la suppression de la classe.' });
      }
    }

    return res.status(400).json({ error: 'Action non reconnue.' });
  }

  return res.status(405).json({ error: 'Méthode non autorisée.' });
}
