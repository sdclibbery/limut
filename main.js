define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  let play = require('play/play');
  let metronome = require('metronome');
  let players = {
    drums: require('player/drums')
  };
  let playerInstances = {};

  window.parse = (textarea) => {
    textarea.value.split('/n').map(l => l.trim()).filter(l => l != '').map(line => {
      let parts = line.split(/(\s+)/).map(p => p.trim()).filter(p => p != '')
      let playerId = parts[0].trim()
      if (playerId) {
        let playerName = parts[1].trim()
        if (playerName) {
          let command  = parts.slice(2).join('').trim()
          playerInstances[playerId] = players[playerName](command)
        } else {
          delete playerInstances[playerId]
        }
      }
    })
  }

  let tick = function () {
    let beat = metronome.update(play.timeNow());
    if (beat) {
      for (let player of Object.values(playerInstances)) {
        player(beat)
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
