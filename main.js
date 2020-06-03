define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  let play = require('play/play');
  let metronome = require('metronome');
  let players = {
    drums: require('player/drums')
  };
  let playerInstances = {};

  window.parse = (button) => {
    let playerId = button.id
    let textarea = document.getElementById(playerId + '-t')
    let parts = textarea.value.split(/(\s+)/)
    let playerName = parts[0].trim()
    if (playerName) {
      let command  = parts.slice(2).join('').trim()
      playerInstances[playerId] = players[playerName](command)
    } else {
      delete playerInstances[playerId]
    }
  }

  let tick = function () {
    let beat = metronome.update(play.timeNow());
    if (beat) {
      for (let player of Object.values(playerInstances)) {
        console.log(player, beat)
        player(beat)
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
