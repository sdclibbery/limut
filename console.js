'use strict';
define(function (require) {

  let cons = document.getElementById('console')
  cons.value = ''
  let consoleOut = (str) => {
    cons.value += '\n'+str
    cons.scrollTop = cons.scrollHeight
  }
  consoleOut('\n> Welcome to Limut')

  return consoleOut
})