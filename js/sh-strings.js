/* Shelf Shift — localized strings for the StarHermit account controls
 * (sign-in, invite link, sign-out notice, results leaderboard line). Locale follows navigator.language
 * via the Graphics panel's picker. Browser global: window.SSShStrings.
 */
(function (root) {
  'use strict';
  var EN = {
    signIn: 'Sign in with StarHermit',
    invite: 'Invite a friend',
    copied: 'Invite link copied',
    copyFailed: 'Could not copy the invite link',
    signedOut: 'Signed out of StarHermit — progress stays on this device',
    lbPosting: 'Posting score to the leaderboard…',
    lbRank: 'Leaderboard rank: #{rank}',
    lbPosted: 'Score posted to the leaderboard.',
    lbNotPosted: 'Score not posted to the leaderboard.'
  };
  var ES = {
    signIn: 'Iniciar sesión con StarHermit',
    invite: 'Invitar a un amigo',
    copied: 'Enlace de invitación copiado',
    copyFailed: 'No se pudo copiar el enlace de invitación',
    signedOut: 'Sesión de StarHermit cerrada: el progreso se queda en este dispositivo',
    lbPosting: 'Publicando la puntuación en la clasificación…',
    lbRank: 'Puesto en la clasificación: #{rank}',
    lbPosted: 'Puntuación publicada en la clasificación.',
    lbNotPosted: 'No se pudo publicar la puntuación en la clasificación.'
  };
  var FR = {
    signIn: 'Se connecter avec StarHermit',
    invite: 'Inviter un ami',
    copied: 'Lien d’invitation copié',
    copyFailed: 'Impossible de copier le lien d’invitation',
    signedOut: 'Déconnecté de StarHermit — la progression reste sur cet appareil',
    lbPosting: 'Envoi du score au classement…',
    lbRank: 'Rang au classement : #{rank}',
    lbPosted: 'Score envoyé au classement.',
    lbNotPosted: 'Score non envoyé au classement.'
  };
  var STRINGS = {
    'en-US': EN, 'en-GB': EN, 'es-419': ES, 'es-ES': Object.assign({}, ES, { lbNotPosted: 'No se ha podido publicar la puntuación en la clasificación.' }),
    'de-DE': {
      signIn: 'Mit StarHermit anmelden',
      invite: 'Freund einladen',
      copied: 'Einladungslink kopiert',
      copyFailed: 'Einladungslink konnte nicht kopiert werden',
      signedOut: 'Von StarHermit abgemeldet – der Fortschritt bleibt auf diesem Gerät',
      lbPosting: 'Punktzahl wird in die Bestenliste eingetragen…',
      lbRank: 'Platz in der Bestenliste: #{rank}',
      lbPosted: 'Punktzahl in die Bestenliste eingetragen.',
      lbNotPosted: 'Punktzahl wurde nicht in die Bestenliste eingetragen.'
    },
    'fr-FR': FR,
    'fr-CA': Object.assign({}, FR, { invite: 'Inviter un ami ou une amie', lbPosting: 'Envoi du pointage au classement…', lbPosted: 'Pointage envoyé au classement.', lbNotPosted: 'Pointage non envoyé au classement.' }),
    'pt-BR': {
      signIn: 'Entrar com StarHermit',
      invite: 'Convidar um amigo',
      copied: 'Link de convite copiado',
      copyFailed: 'Não foi possível copiar o link de convite',
      signedOut: 'Sessão do StarHermit encerrada — o progresso fica neste dispositivo',
      lbPosting: 'Enviando pontuação para o placar…',
      lbRank: 'Posição no placar: #{rank}',
      lbPosted: 'Pontuação enviada para o placar.',
      lbNotPosted: 'A pontuação não foi enviada para o placar.'
    },
    'it-IT': {
      signIn: 'Accedi con StarHermit',
      invite: 'Invita un amico',
      copied: 'Link di invito copiato',
      copyFailed: 'Impossibile copiare il link di invito',
      signedOut: 'Disconnesso da StarHermit: i progressi restano su questo dispositivo',
      lbPosting: 'Invio del punteggio alla classifica…',
      lbRank: 'Posizione in classifica: #{rank}',
      lbPosted: 'Punteggio inviato alla classifica.',
      lbNotPosted: 'Punteggio non inviato alla classifica.'
    }
  };
  function strings(tag) {
    var key = root.SSGfx ? root.SSGfx.pickLocale(tag) : 'en-US';
    return STRINGS[key] || EN;
  }
  var api = { STRINGS: STRINGS, strings: strings };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSShStrings = api;
})(typeof self !== 'undefined' ? self : this);
