# Save Game Linker

Moves actual save games to a specified folder, and symlinks destinations.

Useful for syncing save games with Dropbox or Google Drive or whatnot.

Can also be used for other stuff such as configuration files and the likes.

## Usage

Requires a `paths.yml`. An example is in the repo.

```sh
save-game-linker --home-dir ~/ --conf ~/Dropbox/Saves/paths-linux.yml --save-dir ~/Dropbox/Saves
save-game-linker --help
```
