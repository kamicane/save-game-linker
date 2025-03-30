import path from 'node:path'

import Fuse from 'fuse.js'
import axios from 'axios'
import fse from 'fs-extra'

export default async function findSteamAppId (gameName, argv) {
  const localSteamAppIdJson = path.join(argv.cacheDir, 'games_appid.json')

  const oneDay = 24 * 60 * 60 * 1000

  let cacheStats, cacheAge

  try {
    cacheStats = await fse.stat(localSteamAppIdJson)
    cacheAge = Date.now() - cacheStats.mtimeMs
  } catch (err) {}

  let steamGames

  if (!cacheStats || cacheAge > oneDay) {
    // console.warn('fetching games_appid.json')

    const steamGamesRaw = await axios.get('https://raw.githubusercontent.com/jsnli/steamappidlist/refs/heads/master/data/games_appid.json')
    steamGames = steamGamesRaw.data
    await fse.writeJson(localSteamAppIdJson, steamGames)
  } else {
    // console.warn('using cached games_appid.json')

    steamGames = await fse.readJson(localSteamAppIdJson)
  }

  const fuseOptions = {
    includeScore: true,
    ignoreDiacritics: true,
    // threshold: 0.1,
    keys: ['name']
  }

  const fuse = new Fuse(steamGames, fuseOptions)

  return fuse.search(gameName)?.[0]?.item ?? false
}
