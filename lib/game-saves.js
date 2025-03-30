import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

import fse from 'fs-extra'

async function linkSave (srcPath, dstPath) {
  await fse.mkdirp(path.dirname(dstPath))
  await fse.symlink(srcPath, dstPath, process.platform === 'win32' ? 'junction' : 'dir')
}

async function isEmpty (path) {
  const files = await fse.readdir(path)
  return files.length === 0
}

export default class GameSaves extends EventEmitter {
  constructor (argv) {
    super()
    this.argv = argv
  }

  async processGameSave (gameName, gameObj) {
    const argv = this.argv

    let gameSavePath = gameObj.saves?.replace(/^~\//, `${os.homedir()}/`)
    if (!gameSavePath) {
      this.emit('game-info', gameName, { type: 'noop', reason: 'no_save_dir' })
      return
    }

    if (!path.isAbsolute(gameSavePath)) {
      gameSavePath = path.join(argv.gamesDir, gameName, gameSavePath)
    }

    gameSavePath = path.resolve(gameSavePath)

    const cloudDir = path.join(argv.savesDir, gameName)

    let cloudStats
    try {
      cloudStats = await fse.lstat(cloudDir)
    } catch (err) { }

    let gameSaveStats
    try {
      gameSaveStats = await fse.lstat(gameSavePath)
    } catch (err) { }

    // const dstReal = dstStats ? await fse.realpath(gameSaveDir) : null

    // scenarios
    // 1: source directory exists, destination does not exist = link
    // 2: source directory exists, destination exists, not already linked = delete destination and link
    // 2: source directory exists, destination exists, already linked = log
    // 2: source directory does not exist, destination exists and is directory = move destination to source and link
    // 2: source directory does not exist, destination exists and is not directory = warn
    // 2: source directory does not exist, destination does not exist = create directories and links?

    if (cloudStats && !cloudStats.isDirectory()) {
      if (!argv.dryRun) await fse.rm(cloudDir, { force: true })
      this.emit('game-info', gameName, { type: 'delete', item: cloudDir, reason: 'not_a_dir' })
      cloudStats = null
    }

    const isCloudDirEmpty = cloudStats ? await isEmpty(cloudDir) : false
    // const isGameSaveSymbolicLink = gameSaveDirStats ? gameSaveDirStats.isSymbolicLink() : false
    // const isGameSaveDirectory = gameSaveDirStats ? gameSaveDirStats.isDirectory() : false

    if (cloudStats && !isCloudDirEmpty) { // cloudDir exists and is a directory and is not empty
      let needsLink = true

      if (gameSaveStats) {
        if (!gameSaveStats.isSymbolicLink()) {
          if (!argv.dryRun) await fse.rm(gameSavePath, { recursive: true, force: true })
          this.emit('game-info', gameName, { type: 'delete', item: gameSavePath, reason: 'already_in_saves' })
        } else {
          let realDst
          try {
            realDst = await fse.realpath(gameSavePath)
          } catch (err) {}

          if (realDst === cloudDir) {
            needsLink = false
            this.emit('game-info', gameName, { type: 'noop', item: gameSavePath, reason: 'already_linked' })
          } else {
            if (!argv.dryRun) await fse.rm(gameSavePath, { recursive: true, force: true })
            this.emit('game-info', gameName, { type: 'delete', item: gameSavePath, reason: 'wrong_symlink' })
          }
        }
      }

      if (needsLink) {
        if (!argv.dryRun) await linkSave(cloudDir, gameSavePath)
        this.emit('game-info', gameName, { type: 'link', from: cloudDir, to: gameSavePath })
      }
    } else if (gameSaveStats && gameSaveStats.isDirectory()) { // either cloudDir doesn't exists or is empty, and gameSaveDirStats exists and is a directory
      if (isCloudDirEmpty) {
        if (!argv.dryRun) await fse.rm(cloudDir, { force: true })
        this.emit('game-info', gameName, { type: 'delete', item: cloudDir, reason: 'empty_dir' })
      }

      if (!argv.dryRun) await fse.rename(gameSavePath, cloudDir)
      this.emit('game-info', gameName, { type: 'move', from: gameSavePath, to: cloudDir })
      if (!argv.dryRun) await linkSave(cloudDir, gameSavePath)
      this.emit('game-info', gameName, { type: 'link', from: cloudDir, to: gameSavePath })
    } else {
      // todo
      this.emit('game-info', gameName, { type: 'noop', item: gameSavePath, reason: 'unknown' })
    }
  }

  async process (gameList) {
    for (const gameName in gameList) {
      const gameObj = gameList[gameName]
      this.emit('game-start', gameName, gameObj)
      try {
        await this.processGameSave(gameName, gameObj)
      } catch (err) {
        this.emit('game-error', gameName, err)
      }

      this.emit('game-end', gameName)
    }
  }
}
