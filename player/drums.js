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

  let splitOnAll = (str, ch) => {
    if (!str) { return [] }
    return str.split(ch).map(x => x.trim()).filter(x => x!=ch)
  }

  let splitOnFirst = (str, ch) => {
    if (!str) { return [] }
    let parts = splitOnAll(str, ch)
    return [parts[0], parts.slice(1).join()]
  }

  return (command) => {
    let [pattern, paramsStr] = splitOnFirst(command, ',')
    let beats = pattern.split('').map(x => soundMap[x])
    let params = {}
    splitOnAll(paramsStr, ',').map(p => splitOnAll(p, '=')).forEach(([n,v]) => params[n] = v)
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
