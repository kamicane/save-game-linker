import os from 'node:os'
import path from 'node:path'
import fse from 'fs-extra'

// import { LinkError } from './util.js'

async function linkSave (srcPath, dstPath) {
  await fse.mkdirp(path.dirname(dstPath))
  await fse.symlink(srcPath, dstPath, process.platform === 'win32' ? 'junction' : 'dir')
  // console.log(`  linked ${nicePath(dstPath, 'yellow')} to ${nicePath(srcPath, 'blue')}`)
}

async function processGameSave (gameName, gameObj, argv) {
  let gameSaveDir = gameObj.saves?.replace(/^~\//, `${os.homedir()}/`)
  if (!path.isAbsolute(gameSaveDir)) {
    gameSaveDir = path.join(argv.gamesDir, gameName, gameSaveDir)
  }

  gameSaveDir = path.resolve(gameSaveDir)

  const cloudDir = path.join(argv.savesDir, gameName)

  let cloudStat
  try {
    cloudStat = await fse.stat(cloudDir)
  } catch (err) { }

  let dstStat
  try {
    dstStat = await fse.stat(gameSaveDir)
  } catch (err) { }

  const dstReal = dstStat ? await fse.realpath(gameSaveDir) : null

  // scenarios
  // 1: source directory exists, destination does not exist = link
  // 2: source directory exists, destination exists, not already linked = delete destination and link
  // 2: source directory exists, destination exists, already linked = log
  // 2: source directory does not exist, destination exists and is directory = move destination to source and link
  // 2: source directory does not exist, destination exists and is not directory = warn
  // 2: source directory does not exist, destination does not exist = create directories and links

  const ops = []

  if (cloudStat && !cloudStat.isDirectory()) {
    await fse.rm(cloudDir, { force: true })
    ops.push({ type: 'delete', item: cloudDir, reason: 'not_a_dir' })
    cloudStat = null
  }

  if (cloudStat) {
    // if (dstReal === cloudReal) {
    //   // console.log(`  ${nicePath(saveDir, 'yellow')} is already linked to ${nicePath(srcDir, 'blue')}`)
    // } else {
    //   try {
    const lstat = await fse.lstat(gameSaveDir)
    if (lstat) {
      await fse.rm(gameSaveDir, { recursive: true, force: true })
      ops.push({ type: 'delete', item: gameSaveDir })
    }
    // } catch (err) { }
    await linkSave(cloudDir, gameSaveDir)
    // }
  } else if (dstStat) {
    // try {
    //   const lstat = await fse.lstat(cloudDir)
    //   if (lstat) {
    //     await fse.rm(cloudDir, { recursive: true, force: true })
    //     ops.push({ type: 'delete', item: cloudDir })
    //   }
    // } catch (err) { }

    await fse.rename(gameSaveDir, cloudDir)
    ops.push({ type: 'move', from: gameSaveDir, to: cloudDir })
    await linkSave(cloudDir, gameSaveDir)
    ops.push({ type: 'link', from: cloudDir, to: gameSaveDir })
  }

  return ops
}

export default async function * processGameSaves (gameList, argv) {
  for (const gameName in gameList) {
    const gameObj = gameList[gameName]
    try {
      yield [gameName, await processGameSave(gameName, gameObj, argv)]
    } catch (err) {
      yield [gameName, err]
    }
  }
}
