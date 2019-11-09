#!/usr/bin/env node
'use strict'

const os = require('os')
const path = require('path')
const fse = require('fs-extra')
const yaml = require('yaml')
const chalk = require('chalk')

const DRY_RUN = false

const HOMEDIR = os.homedir()

const SAVES_PATH = path.join(HOMEDIR, 'Dropbox', 'Saves')
const YAML_PATH = path.join(SAVES_PATH, 'paths.yml')

const IS_WINDOWS = process.platform === 'win32'

const MAPPINGS = {
  $SAVED_GAMES: ['Saved Games'],
  $APPDATA_ROAMING: ['AppData/Roaming', 'Application Data'],
  $APPDATA_LOCAL: ['AppData/Local', 'Local Settings', 'Local Settings/Application Data'],
  $DOCUMENTS: ['Documents', 'My Documents'],
  $APPDATA_LOCAL_LOW: ['AppData/LocalLow']
}

if (!IS_WINDOWS && !process.argv[2]) {
  console.warn('You must provide a path on linux')
  process.exit(0)
}

const LINK_DIR = IS_WINDOWS ? HOMEDIR : path.resolve(process.argv[2])

async function linkSaveGame (srcPath, dstPath) {
  if (!DRY_RUN) await fse.ensureSymlink(srcPath, dstPath, IS_WINDOWS ? 'junction' : 'dir')
  console.log('\t', 'linked', chalk.blue(nicePath(dstPath)))
}

function nicePath (p) {
  return path.relative(LINK_DIR, p)
}

async function processGame (gameName, dstPaths) {
  const srcPath = path.join(SAVES_PATH, gameName)

  const statMap = {}

  for (const dstPath of dstPaths) {
    let dstStats
    try {
      dstStats = await fse.stat(dstPath)
    } catch (err) {}

    statMap[dstPath] = dstStats
  }

  let srcStats
  try {
    srcStats = await fse.stat(srcPath)
  } catch (err) {}

  if (srcStats && srcStats.isDirectory()) {
    // game save is found in your Dropbox
    // destroy everything and relink everything
    console.log(chalk.magenta(gameName))

    for (const dstPath in statMap) {
      const dstStats = statMap[dstPath]
      if (dstStats) {
        const realPath = await fse.realpath(dstPath)

        if (realPath === srcPath) {
          console.log('\t', chalk.green(nicePath(dstPath)), 'is already linked to Dropbox')
        } else if (dstStats.isDirectory()) {
          if (!DRY_RUN) await fse.remove(realPath)
          console.log('\t', chalk.red(nicePath(dstPath)), 'is a directory, removed')
          await linkSaveGame(srcPath, dstPath)
        } else {
          console.log('\t', chalk.red(nicePath(dstPath)), 'is of an unknown type')
        }
      } else {
        console.log('\t', chalk.yellow(nicePath(dstPath)), 'was not present')
        await linkSaveGame(srcPath, dstPath)
      }
    }
  } else if (!srcStats) {
    console.log(chalk.red(gameName), 'is not in Dropbox')
    // save is not in your Dropbox (yet)
    for (const dstPath in statMap) {
      const dstStats = statMap[dstPath]
      if (dstStats && dstStats.isDirectory()) {
        // if destination exists move to Dropbox
        console.log('\t', chalk.blue(nicePath(dstPath)), 'moved to Dropbox')
        if (!DRY_RUN) await fse.move(dstPath, srcPath)
        // and reprocess game
        await processGame(gameName, dstPaths)
        break
      }
    }
  }
}

async function relink () {
  const saveGames = await fse.readFile(YAML_PATH, 'utf8')
  const saveGameList = await yaml.parse(saveGames)

  for (const gameName in saveGameList) {
    const gamePath = saveGameList[gameName]
    if (!/^\$/.test(gamePath)) continue

    const parts = gamePath.split('/')
    const TYPE = parts.shift()

    const dstPaths = new Set()
    const dstBases = MAPPINGS[TYPE]
    for (const dstBase of dstBases) {
      const dstBaseFull = path.join(LINK_DIR, dstBase)
      const dstBaseReal = await fse.realpath(dstBaseFull)
      dstPaths.add(path.join(dstBaseReal, ...parts))
    }

    await processGame(gameName, dstPaths)
  }
}

relink()
