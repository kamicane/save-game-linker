import path from 'node:path'
import { crc32 } from 'node:zlib'
import fse from 'fs-extra'
import SteamCat from 'steam-categories'
import { readVdf, writeVdf } from 'steam-binary-vdf'

// import chalk from 'chalk'

import { LinkError } from './util.js'

function genSteamAppId (exePath) {
  const crc = crc32(exePath + '\0') // Append null byte
  return (crc | 0x80000000) >>> 0 // Set highest bit
}

async function decodeSteamShortcutsFile (file) {
  const inBuffer = await fse.readFile(file)
  return readVdf(inBuffer)
}

async function encodeSteamShortcutsFile (file, obj) {
  const outBuffer = writeVdf(obj)
  await fse.writeFile(file, outBuffer)
}

async function processSteamShortcut (gameName, gameObj, argv) {
  const exeFullPath = path.join(argv.gamesDir, gameName, gameObj.exe)
  const exeExists = await fse.exists(exeFullPath)

  if (exeExists) {
    const steamShortcut = {
      appid: genSteamAppId(path.join(gameName, gameObj.exe)),
      appname: gameName,
      Exe: `"${exeFullPath}"`,
      StartDir: `"${path.join(argv.gamesDir, gameName)}"`,
      LaunchOptions: gameObj.args || '',
      tags: { 0: argv.appName }
    }

    return steamShortcut
  } else {
    throw new LinkError(exeFullPath, 'EXE_NOT_FOUND')
  }
}

export default async function * writeSteamShortcuts (gameList, argv) {
  const oldShortcutsVdf = await decodeSteamShortcutsFile(argv.steamShortcutsFile)

  const oldShortcuts = {}
  const allShortcuts = []

  for (const steamShortcut of Object.values(oldShortcutsVdf.shortcuts)) {
    const isSGLGame = Object.values(steamShortcut.tags).includes(argv.appName)
    if (!isSGLGame) allShortcuts.push(steamShortcut)
    else oldShortcuts[steamShortcut.appid] = steamShortcut
  }

  for (const gameName in gameList) {
    const gameObj = gameList[gameName]
    if (gameObj.exe == null) {
      yield [gameName, null]
      continue
    }
    try {
      const steamShortcut = await processSteamShortcut(gameName, gameObj, argv)

      const oldShortcut = oldShortcuts[steamShortcut.appid]
      if (oldShortcut) {
        oldShortcut.Exe = steamShortcut.Exe
        oldShortcut.StartDir = steamShortcut.StartDir
        oldShortcut.LaunchOptions = steamShortcut.LaunchOptions
        allShortcuts.push(oldShortcut)
      } else {
        allShortcuts.push(steamShortcut)
      }

      yield [gameName, steamShortcut.appid]
    } catch (err) {
      yield [gameName, err]
    }
  }

  const cats = new SteamCat(argv.steamLevelDB, argv.steamUserId)

  try {
    const collections = await cats.read()
    await fse.writeJSON('collections.json', collections, { spaces: 2 })
    for (const id in collections) {
      const collObj = collections[id]
      for (const collName in collObj) {
        const coll = collObj[collName]
        if (collName === `user-collections.${argv.appName}` || coll.is_deleted === true) {
          delete cats.collections[id][collName]
        }
      }
    }
  } catch (err) {
    throw new LinkError('Error reading steam categories', 'STEAM_CATEGORIES')
  }

  // let sglCollection = cats.get(appName)

  // if (!sglCollection) {
  //   sglCollection = cats.add(appName, {
  //     name: steamCollectionName
  //   })
  // }

  const sglCollection = cats.add(argv.appName, {
    name: argv.steamCollection
  })

  sglCollection.value.added = []

  const newShortcutsObj = { shortcuts: {} }

  let steamObjIdx = 0
  for (const steamShortcut of allShortcuts) {
    newShortcutsObj.shortcuts[steamObjIdx++] = steamShortcut
    sglCollection.value.added.push(steamShortcut.appid)
  }

  await encodeSteamShortcutsFile(argv.steamShortcutsFile, newShortcutsObj)

  await cats.save()
  await cats.close()
}
