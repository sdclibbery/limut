define(function(require) {
  var percussion = require('play/percussion');

  let soundMap = {
    'x':'kick',
    'X':'kickLoud',
    'o':'snare',
    'O':'snareLoud',
    '-':'closedhat',
    '+':'closedhatLoud',
    '=':'openhat',
    '#':'openhatLoud'
  }

  return (command) => {
    let parts = command.split(',').map(x => x.trim()).filter(x => x!=',')
    let pattern = parts[0]
    let beats = pattern.split('').map(x => soundMap[x])
    let params = {}
    parts.slice(1).map(p => p.split('=')).forEach(([n,v]) => params[n] = v)
    return (beat) => {
      let dur = params.dur || 1
      let ticksPerBeat = 1/dur
      for (subCount = 0; subCount < ticksPerBeat; subCount++) {
        let method = percussion[beats[(beat.count*ticksPerBeat+subCount) % beats.length]]
        if (method) { method(beat.time + subCount*beat.duration/ticksPerBeat) }
      }
    }
  }
});
