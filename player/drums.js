define(function(require) {
  var percussion = require('play/percussion');

  return (command) => {
    let beats = command
      .split('')
      .map(x => ({'x':'kick', 'o':'snare', '=':'openhat', '-':'closedhat'}[x]))
    return (beat) => percussion[beats[beat.count % beats.length]](beat.time)
  }
});
