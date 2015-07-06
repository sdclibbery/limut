// User Interface adapter for beats

define(function (require) {
var metronome = require('music/metronome');

var beats = {};

var init = '31\n21\n31\n21';
window.beatsUIChange = function (ta) { beats.change(ta.value); };
var html = '<p><textarea id="beats" rows="9" cols="32" oninput="beatsUIChange(this)">'+init+'</textarea></p>';
document.body.innerHTML += html;

beats.change = function (v) {
  metronome.beats(parse(v));
};

var parse = function (v) {
  var bs = [];
  var ds = [];
  for (var i = 0; i < v.length; i++) {
    var c = v[i];
    if (c === '\n') {
      bs.push(ds);
      ds = [];
    } else if (c === '3') {
      ds.push(3);
    } else if (c === '2') {
      ds.push(2);
    } else if (c === '1') {
      ds.push(1);
    } else {
      ds.push(0);
    }
  }
  if (ds.length > 0) { bs.push(ds); }
console.log('v: '+v);
console.log('bs: '+bs);
  return bs;
};

beats.change(init);
return beats;
});
