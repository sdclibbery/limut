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
    var name = 'drum-'+s+'-'+i;
    markup += '<td><div id="'+name+'" class="toggle" data-value="off" onclick="drumChange(event.target);" >&nbsp;</div</td>';
  });
  markup += '</tr>';
}
markup = '<table>'+markup+'</table>';
window.drumChange = function (el) {
  console.log(el);
  console.log(el.id);
  console.log(el.dataset.value);
  el.dataset.value = el.dataset.value === 'off' ? 'on' : 'off';
  console.log(el.dataset.value);
//  myDrummer.beatsPerMeasure(ta.value);
};

var html = '<div class="widget"><h5>drummer</h5>'+markup+'</div>';
document.body.innerHTML += html;

return drummer;
});
