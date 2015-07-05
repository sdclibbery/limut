// Performance Domain

define(['play/percussion'], function (percussion) {

var drummer = {};

drummer.beat = function (beat) {
  if (beat.strength === 'down') {
    percussion.kick(beat.time);
  }
  if (beat.strength === 'up') {
    percussion.snare(beat.time);
  }
  beat.subBeats.map(function (time) {
    percussion.hat(beat.time + time*beat.duration);
  });
};

return drummer;
});
