import path from 'node:path'
import { crc32 } from 'node:zlib'
import { EventEmitter } from 'node:events'

import fse from 'fs-extra'
import { parseICO } from 'icojs'
import SteamCat from 'steam-categories'
import { readVdf, writeVdf } from 'steam-binary-vdf'

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

export default class SteamShortcuts extends EventEmitter {
  async processGame (gameName, gameObj, argv) {
    const exeFullPath = path.join(argv.gamesDir, gameName, gameObj.exe)
    const exeExists = await fse.exists(exeFullPath)

    if (exeExists) {
      const icoPath = path.join(argv.iconDir, `${gameName}.ico`)
      let steamIconPath
      try {
        const icoBuffer = await fse.readFile(icoPath)
        const images = await parseICO(icoBuffer, 'image/png')
        const image = images.reduce((prev, curr) => (curr.width > prev.width ? curr : prev))

        const data = Buffer.from(image.buffer)
        const icoPngPath = path.join(argv.iconCacheDir, `${gameName}.png`)

        await fse.writeFile(icoPngPath, data)
        steamIconPath = icoPngPath
      } catch (err) {}

      const steamShortcut = {
        appid: genSteamAppId(path.join(gameName, gameObj.exe)),
        appname: gameName,
        Exe: `"${exeFullPath}"`,
        StartDir: `"${path.join(argv.gamesDir, gameName)}"`,
        LaunchOptions: gameObj.args || '',
        tags: { 0: argv.appName },
        icon: steamIconPath || ''
      }

      this.emit('game-info', gameName, { type: 'create', item: steamShortcut.appid })
      return steamShortcut
    }

    this.emit('game-info', gameName, { type: 'noop', reason: 'exe_not_found', item: exeFullPath })
    return null
  }

  async process (gameList, argv) {
    const oldShortcutsVdf = await decodeSteamShortcutsFile(argv.steamShortcutsFile)

    const oldShortcuts = {}
    const allShortcuts = []

    for (const oldShortcut of Object.values(oldShortcutsVdf.shortcuts)) {
      const isSGLGame = Object.values(oldShortcut.tags).includes(argv.appName)
      if (!isSGLGame) allShortcuts.push(oldShortcut)
      else oldShortcuts[oldShortcut.appid] = oldShortcut
    }

    for (const gameName in gameList) {
      const gameObj = gameList[gameName]
      this.emit('game-start', gameName, gameObj)

      if (gameObj.exe == null) {
        this.emit('game-info', gameName, { type: 'noop', reason: 'no_exe' })
        continue
      }
      try {
        const steamShortcut = await this.processGame(gameName, gameObj, argv)
        if (!steamShortcut) {
          continue
        }

        const oldShortcut = oldShortcuts[steamShortcut.appid]
        if (oldShortcut) {
          oldShortcut.Exe = steamShortcut.Exe
          oldShortcut.StartDir = steamShortcut.StartDir
          oldShortcut.LaunchOptions = steamShortcut.LaunchOptions
          oldShortcut.icon = steamShortcut.icon
          allShortcuts.push(oldShortcut)
        } else {
          allShortcuts.push(steamShortcut)
        }
      } catch (err) {
        this.emit('game-error', gameName, err)
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
      this.emit('error', err)
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
}
