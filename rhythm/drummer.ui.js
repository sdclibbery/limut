// User Interface adapter for drummer

define(function (require) {
var myDrummer = require('rhythm/drummer');

var drummer = {};

var instruments = ['kick', 'snare', 'hat'];

var markup = '';
markup += '<tr><th></th>';
instruments.map(function (i) { markup += '<th>'+i+'</th>' });
markup += '</tr>';
for (var s = 3; s > 0; s--) {
  markup += '<tr><th>'+s+'</th>';
  instruments.map(function (i) {
    markup += '<td><div class="toggle" data-strength="'+s+'" data-instrument="'+i+'" data-value="off" onclick="drumChange(event.target);" >&nbsp;</div</td>';
  });
  markup += '</tr>';
}
markup = '<table>'+markup+'</table>';
window.drumChange = function (el) {
  el.dataset.value = el.dataset.value === 'off' ? 'on' : 'off';
  myDrummer[el.dataset.value](el.dataset.strength, el.dataset.instrument);
};

var html = '<div class="widget"><h5>drummer</h5>'+markup+'</div>';
document.body.innerHTML += html;

return drummer;
});
