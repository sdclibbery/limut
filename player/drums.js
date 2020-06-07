define(function(require) {
  var parsePattern = require('player/pattern');
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

  let parseParams = (paramsStr) => {
    let params = {}
    splitOnAll(paramsStr, ',')
      .map(p => splitOnAll(p, '='))
      .forEach(([n,v]) => params[n] = v)
    return params
  }

  return (command) => {
    let [pattern, paramsStr] = splitOnFirst(command, ',')
    let params = parseParams(paramsStr)
    let events = parsePattern(pattern, params)
    return (beat) => {
      let eventsForBeat = events[beat.count % events.length]
      eventsForBeat.forEach(event => {
        percussion.play(event.sound, beat.time + event.time, event)
      })
    }
  }
});
