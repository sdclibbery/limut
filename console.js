'use strict';
define(function (require) {
  let cons = document.getElementById('console')
  cons.value = ''
  let lastStr
  let consoleOut = (str) => {
    console.log(str)
    if (str === lastStr) { return }
    lastStr = str
    cons.value += '\n'+str
    cons.scrollTop = cons.scrollHeight
  }
  consoleOut('\n Welcome to Limut\n')

  let commands = {}
  cons.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      let line = event.target.value.split('\n').pop().trim()
      let args = line.split(' ')
      let cmd = (args[0] || '').toLowerCase()
      if (commands[cmd]) {
        console.log('Console Command: ' + line)
        commands[cmd](args.slice(1), line)
      }
    }
  })
  consoleOut.addCommand = (name, func) => { commands[name] = func }

return consoleOut
})
