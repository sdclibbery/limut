define(function(require) {
  var parsePattern = require('player/pattern');

  let splitOnAll = (str, ch) => {
    if (!str) { return [] }
    return str.split(ch).map(x => x.trim()).filter(x => x!=ch)
  }

  let splitOnFirst = (str, ch) => {
    if (!str) { return [] }
    let parts = splitOnAll(str, ch)
    return [parts[0], parts.slice(1).join()]
  }

  let parseParams = (paramsStr) => {
    let params = {}
    splitOnAll(paramsStr, ', ')
      .map(p => splitOnAll(p, '='))
      .forEach(([n,v]) => params[n.toLowerCase()] = v)
    return params
  }

  return (play) => (command) => {
    let [patternStr, paramsStr] = splitOnFirst(command, ',')
    let params = parseParams(paramsStr)
    let pattern = parsePattern(patternStr, params)
    return (beat) => {
      let eventsForBeat = pattern(beat.count)
      eventsForBeat.forEach(event => {
        let eventToPlay = Object.assign({}, event, {sound: event.value, beat: beat})
        eventToPlay.time = beat.time + event.time*beat.duration
        play(eventToPlay)
      })
    }
  }
});
