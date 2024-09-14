#!/usr/bin/env node

import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

import chalk from 'chalk'
import yaml from 'yaml'
import yargs from 'yargs/yargs'

let HOME_DIR
let DRY_RUN
let SAVES_DIR

function nicePath (p) {
  return path.relative(HOME_DIR, p)
}

async function linkSave (srcPath, dstPath) {
  if (!DRY_RUN) {
    await fsp.symlink(srcPath, dstPath, process.platform === 'win32' ? 'junction' : 'dir')
  }
  console.log(`  linked ${chalk.yellow(nicePath(dstPath))} to ${chalk.blue(nicePath(srcPath))}`)
}

async function processGame (gameName, saveDir) {
  const srcDir = path.join(SAVES_DIR, gameName)

  let srcStat
  try {
    srcStat = await fsp.stat(srcDir)
  } catch (err) {}

  const srcReal = srcStat ? await fsp.realpath(srcDir) : null

  let dstStat
  try {
    dstStat = await fsp.stat(saveDir)
  } catch (err) {}

  const dstReal = dstStat ? await fsp.realpath(saveDir) : null

  // scenarios
  // 1: source directory exists, destination does not exist = link
  // 2: source directory exists, destination exists, not already linked = delete destination and link
  // 2: source directory exists, destination exists, already linked = log
  // 2: source directory does not exist, destination exists and is directory = move destination to source and link
  // 2: source directory does not exist, destination exists and is not directory = warn
  // 2: source directory does not exist, destination does not exist = do nothing, no warn

  if (srcStat && srcStat.isDirectory()) {
    console.log(`${chalk.green(gameName)}`)

    if (dstReal === srcReal) {
      console.log(`  ${chalk.yellow(nicePath(saveDir))} is already linked to ${chalk.blue(nicePath(srcDir))}`)
    } else {
      try {
        const lstat = await fsp.lstat(saveDir)
        if (lstat && !DRY_RUN) await fsp.rm(saveDir, { recursive: true, force: true })
        if (lstat) console.log(`  ${chalk.red(nicePath(saveDir))} was deleted`)
      } catch (err) {}
      await linkSave(srcDir, saveDir)
    }
  } else if (dstStat && dstStat.isDirectory()) {
    console.log(`${chalk.magenta(gameName)}`)

    try {
      const lstat = await fsp.lstat(srcDir)
      if (lstat && !DRY_RUN) await fsp.rm(srcDir, { recursive: true, force: true })
      if (lstat) console.log(`  ${chalk.red(nicePath(srcDir))} was deleted`)
    } catch (err) {}
    if (!DRY_RUN) await fsp.rename(saveDir, srcDir)
    console.log(`  moved ${chalk.blue(nicePath(saveDir))} to ${chalk.blue(nicePath(SAVES_DIR))}`)
    await linkSave(srcDir, saveDir)
  } else {
    console.log(`${chalk.gray(gameName)}`)
  }
}

async function init () {
  const confFile = path.join(os.homedir(), '.save-game-linker')
  let configuration

  try {
    const configurationText = await fsp.readFile(confFile, 'utf-8')
    configuration = yaml.parse(configurationText)
  } catch (err) {}

  let homeDirDefault = os.homedir()
  let savesDirDefault = path.join(homeDirDefault, 'Dropbox', 'Saves')
  let pathsFileDefault

  if (configuration != null) {
    if (configuration.saves_dir) savesDirDefault = configuration.saves_dir
    if (configuration.paths_file) pathsFileDefault = configuration.paths_file
    if (configuration.home_dir) homeDirDefault = configuration.home_dir
  }

  if (pathsFileDefault == null) {
    pathsFileDefault = path.join(savesDirDefault, 'paths.yml')
  }

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
    default: homeDirDefault,
    type: 'string',
    normalize: true,
    describe: 'user home dir'
  })

  parser.option('saves-dir', {
    default: savesDirDefault,
    type: 'string',
    normalize: true,
    describe: 'where to store save directories'
  })

  parser.option('paths-file', {
    default: pathsFileDefault,
    type: 'string',
    normalize: true,
    describe: 'paths file to use'
  })

  parser.epilogue('https://github.com/kamicane/save-game-linker')

  const argv = parser.parse()

  const pathsFile = path.resolve(argv.pathsFile)

  HOME_DIR = path.resolve(argv.homeDir)
  SAVES_DIR = path.resolve(argv.savesDir)
  DRY_RUN = argv.dryRun

  console.log('Home Directory : ', chalk.blue(HOME_DIR))
  console.log('Saves Directory: ', chalk.blue(SAVES_DIR))
  console.log('Paths file     : ', chalk.blue(pathsFile))
  console.log('Dry run        : ', chalk.blue(DRY_RUN), '\n')

  const paths = await fsp.readFile(pathsFile, 'utf8')
  const gameList = await yaml.parse(paths)

  for (const gameName in gameList) {
    const saveDir = gameList[gameName].replace(/^~\//, `${HOME_DIR}/`)

    await processGame(gameName, path.resolve(saveDir))
  }
}

init()
