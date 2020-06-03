define(function(require) {
  var percussion = require('play/percussion');

  return (command) => {
    //ToDo: parse the command
    return (beat) => percussion.kick(beat.time)
  }
});
