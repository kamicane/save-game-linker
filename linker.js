#!/usr/bin/env node

import chalk from 'chalk'
import os from 'node:os'
import path from 'node:path'
import fse from 'fs-extra'
import yaml from 'yaml'

import yargs from 'yargs/yargs'

const IS_WINDOWS = process.platform === 'win32'

const USER_DIR_DEFAULT = os.homedir()
const PUBLIC_DIR_DEFAULT = path.join(USER_DIR_DEFAULT, '../Public')
const SAVE_DIR_DEFAULT = path.join(USER_DIR_DEFAULT, 'Dropbox', 'Saves')
const CONF_FILE_DEFAULT = path.join(SAVE_DIR_DEFAULT, `paths-${IS_WINDOWS ? 'windows' : 'linux'}.yml`)

const parser = yargs(process.argv.slice(2))

parser
  .alias('h', 'help')
  .alias('v', 'version')

parser.option('dry-run', {
  default: false,
  type: 'boolean',
  describe: 'do not make any file system modifications'
})

parser.option('home-dir', {
  default: USER_DIR_DEFAULT,
  type: 'string',
  normalize: true,
  describe: 'user home dir'
})

parser.option('public-dir', {
  default: PUBLIC_DIR_DEFAULT,
  type: 'string',
  normalize: true,
  describe: 'public user home dir'
})

parser.option('save-dir', {
  default: SAVE_DIR_DEFAULT,
  type: 'string',
  normalize: true,
  describe: 'where to store save directories'
})

parser.option('conf', {
  default: CONF_FILE_DEFAULT,
  type: 'string',
  normalize: true,
  describe: 'configuration file to use'
})

parser.epilogue('https://github.com/kamicane/save-game-linker')

const argv = parser.parse()

const HOME_DIR = path.resolve(argv.homeDir)
const CONF_FILE = path.resolve(argv.conf)
const SAVE_DIR = path.resolve(argv.saveDir)
const PUBLIC_DIR = path.resolve(argv.publicDir)
const DRY_RUN = argv.dryRun

console.log('using HOME_DIR: ', chalk.green(HOME_DIR))
console.log('using SAVE_DIR: ', chalk.blue(SAVE_DIR))
console.log('using CONF_FILE: ', chalk.blue(CONF_FILE))
console.log('using DRY_RUN: ', chalk.red(DRY_RUN), '\n')

const MAPPINGS = {
  $CODEX: [path.join(HOME_DIR, 'AppData/Roaming/Steam/CODEX'), path.join(PUBLIC_DIR, 'Documents/Steam/CODEX')],
  $SAVED_GAMES: [path.join(HOME_DIR, 'Saved Games')],
  $APPDATA_ROAMING: [path.join(HOME_DIR, 'AppData/Roaming')/* , path.join(HOME_DIR, 'Application Data') */],
  $APPDATA_LOCAL: [path.join(HOME_DIR, 'AppData/Local')/* , path.join(HOME_DIR, 'Local Settings') *//*, path.join(HOME_DIR, 'Local Settings/Application Data') */],
  $DOCUMENTS: [path.join(HOME_DIR, 'Documents')/* , path.join(HOME_DIR, 'My Documents') */],
  $MY_GAMES: [path.join(HOME_DIR, 'Documents/My Games')/* , path.join(HOME_DIR, 'My Documents/My Games') */],
  $APPDATA_LOCAL_LOW: [path.join(HOME_DIR, 'AppData/LocalLow')]
}

function nicePath (p) {
  return path.relative(HOME_DIR, p)
}

const PRETTY_SAVE_DIR = chalk.blue(nicePath(SAVE_DIR))

async function linkSave (srcPath, dstPath) {
  if (!DRY_RUN) await fse.ensureSymlink(srcPath, dstPath, IS_WINDOWS ? 'junction' : 'dir')
  console.log('\t', 'linked', chalk.yellow(nicePath(dstPath)), 'to', chalk.blue(nicePath(srcPath)))
}

async function linkSaves (gameName, srcPath, statMap) {
  for (const dstPath in statMap) {
    const dstStats = statMap[dstPath]
    if (dstStats) { // exists already
      const realPath = await fse.realpath(dstPath)

      if (realPath === srcPath) { // exists and is a symlink already pointing to savePath
        console.log('\t', chalk.green(nicePath(dstPath)), 'is already linked to', chalk.blue(nicePath(srcPath)))
      } else if (dstStats.isDirectory()) {
        if (!DRY_RUN) await fse.remove(realPath)
        console.log('\t', chalk.red(nicePath(dstPath)), 'is a directory, destroyed')
        await linkSave(srcPath, dstPath)
      } else {
        if (!DRY_RUN) await fse.remove(realPath)
        console.log('\t', chalk.red(nicePath(dstPath)), 'is of an unknown type, destroyed')
        await linkSave(srcPath, dstPath)
      }
    } else { // doesn't exist
      await linkSave(srcPath, dstPath)
    }
  }
}

async function processGame (gameName, dstPaths) {
  const srcPath = path.join(SAVE_DIR, gameName)

  const statMap = {}

  for (const dstPath of dstPaths) {
    let dstStats = null
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
    // game save is found in your save dir
    // destroy everything and relink everything
    console.log(chalk.magenta(gameName), 'is already in', PRETTY_SAVE_DIR, 'everything else will be destroyed')

    await linkSaves(gameName, srcPath, statMap)
  } else if (!srcStats) {
    console.log(chalk.red(gameName), 'is not in', PRETTY_SAVE_DIR, 'trying to find a source...')
    // save is not in your save dir (yet)
    for (const dstPath in statMap) {
      const dstStats = statMap[dstPath]
      if (dstStats && dstStats.isDirectory()) {
        // if destination exists move to save dir
        console.log('\t', chalk.blue(nicePath(dstPath)), 'exists, moved to', PRETTY_SAVE_DIR, 'extra copies will be destroyed and relinked.')
        if (!DRY_RUN) await fse.move(dstPath, srcPath)
        // and linkSaves
        statMap[dstPath] = null
        await linkSaves(gameName, srcPath, statMap)

        break // !important: break at first directory found.
      }
    }
  } else {
    // should never happen
    console.log('\t', chalk.red(nicePath(srcPath)), 'is of an unknown type, skipping...')
  }
}

async function relink () {
  const saveGames = await fse.readFile(CONF_FILE, 'utf8')
  const saveGameList = await yaml.parse(saveGames)

  for (const gameName in saveGameList) {
    const gamePath = saveGameList[gameName]
    const dstPaths = new Set()

    if (!/^\$/.test(gamePath)) {
      const homeGamePath = gamePath.replace(/^~\//, '') // replace ~/ just in case
      dstPaths.add(path.resolve(HOME_DIR, homeGamePath))
    } else { // mappings are for windows games only, but work for wine installations as well.
      const parts = gamePath.split('/')
      const type = parts.shift()

      const dstBases = MAPPINGS[type]
      for (const dstBase of dstBases) {
        const dstBaseFull = path.resolve(dstBase)
        // Real paths only, Set will not accept duplicates
        let dstBaseReal
        try {
          dstBaseReal = await fse.realpath(dstBaseFull)
        } catch (err) {
          dstBaseReal = dstBaseFull
        }
        dstPaths.add(path.join(dstBaseReal, ...parts))
      }
    }

    await processGame(gameName, dstPaths)
  }
}

relink()
