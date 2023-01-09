'use strict'
define((require) => {
  let consoleOut = require('console')

  let includeCache = {}

  let getInclude = async (url, suppressLogs) => {
    if (!!includeCache[url]) {
      return includeCache[url]
    }
    if (!suppressLogs) { consoleOut(`Fetching include ${url}`) }
    let response = await fetch(url)
    if (!response.ok) { throw `Failed to include ${url} with status ${response.status}` }
    let includeCode = response.text()
    includeCache[url] = includeCode
    return includeCode
  }

  return getInclude
})