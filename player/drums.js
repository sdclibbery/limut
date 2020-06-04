define(function(require) {
  var percussion = require('play/percussion');

  return (command) => {
    let parts = command.split(',').map(x => x.trim()).filter(x => x!=',')
    let pattern = parts[0]
    let params = parts.slice(1)
    let beats = pattern
      .split('')
      .map(x => ({
        'x':'kick',
        'X':'kickLoud',
        'o':'snare',
        'O':'snareLoud',
        '-':'closedhat',
        '+':'closedhatLoud',
        '=':'openhat',
        '#':'openhatLoud'
      }[x]))
    return (beat) => {
      let method = percussion[beats[beat.count % beats.length]]
      if (method) { method(beat.time) }
    }
  }
});
