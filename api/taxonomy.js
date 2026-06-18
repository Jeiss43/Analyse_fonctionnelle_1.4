// centralisation de la taxonomie et du mappage des erreurs

function mapErrorType(errorType, statusVal, commentVal) {
  let type = errorType || null;

  // Nettoyage de la valeur de retour
  if (type === 'none' || type === 'null' || statusVal === 'CORRECTE') {
    return null;
  }

  // Mapper les anciens codes d'erreurs vers les nouveaux libellés
  if (type === 'verbe_action') type = 'rigueur_formulation';
  if (type === 'fin_de_vie') type = 'hors_cadre_usage';

  // Rétrocompatibilité / Fallback au cas où l'IA ne l'a pas fourni
  if (statusVal !== 'CORRECTE' && !type) {
    const comm = (commentVal || "").toLowerCase();
    if (comm.indexOf('physique') !== -1 || comm.indexOf('solution') !== -1) {
      type = 'solution_physique';
    } else if (comm.indexOf('infinitif') !== -1 || comm.indexOf('negation') !== -1 || comm.indexOf('adverbe') !== -1) {
      type = 'rigueur_formulation';
    } else if (comm.indexOf('etat') !== -1 || comm.indexOf('être') !== -1 || comm.indexOf('avoir') !== -1) {
      type = 'verbe_etat';
    } else if (comm.indexOf('complement') !== -1 || comm.indexOf('eme') !== -1) {
      type = 'manque_eme';
    } else if (comm.indexOf('fin de vie') !== -1 || comm.indexOf('recyclage') !== -1 || comm.indexOf('economi') !== -1 || comm.indexOf('poids') !== -1) {
      type = 'hors_cadre_usage';
    } else if (comm.indexOf('hors sujet') !== -1 || comm.indexOf('impossible') !== -1 || comm.indexOf('incompatible') !== -1) {
      type = 'hors_sujet';
    } else {
      type = 'autre_incorrect';
    }
  }

  return type || 'autre_incorrect';
}

module.exports = { mapErrorType };
