'use strict'
define((require) => {
  let consoleOut = require('console')

  let getInclude = async (url) => {
    consoleOut(`> Including ${url}`)
    return (await fetch(url)).text()
  }

  return getInclude
})