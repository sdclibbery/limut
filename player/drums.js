define(function(require) {
  var percussion = require('play/percussion');

  let splitOnAll = (str, ch) => {
    if (!str) { return [] }
    return str.split(ch).map(x => x.trim()).filter(x => x!=ch)
  }

  let splitOnFirst = (str, ch) => {
    if (!str) { return [] }
    let parts = splitOnAll(str, ch)
    return [parts[0], parts.slice(1).join()]
  }

  let parsePattern = (pattern, params) => {
    return pattern.split('')
  }

  return (command) => {
    let [pattern, paramsStr] = splitOnFirst(command, ',')
    let params = {}
    splitOnAll(paramsStr, ',').map(p => splitOnAll(p, '=')).forEach(([n,v]) => params[n] = v)
    let steps = parsePattern(pattern, params)
    return (beat) => {
      let dur = params.dur || 1
      let ticksPerBeat = 1/dur
      for (subCount = 0; subCount < ticksPerBeat; subCount++) {
        let sound = steps[(beat.count*ticksPerBeat+subCount) % steps.length]
        percussion.play(sound, beat.time + subCount*beat.duration/ticksPerBeat, params)
      }
    }
  }
});
