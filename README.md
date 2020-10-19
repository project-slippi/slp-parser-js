# `slippi-js`

[![npm version](http://img.shields.io/npm/v/@slippi/slippi-js.svg?style=flat)](https://npmjs.org/package/@slippi/slippi-js "View this project on npm")
[![Build Status](https://github.com/project-slippi/slippi-js/workflows/build/badge.svg)](https://github.com/project-slippi/slippi-js/actions?workflow=build)
[![License](https://img.shields.io/npm/l/@slippi/slippi-js)](https://github.com/project-slippi/slippi-js/blob/master/LICENSE)

This is the official Project Slippi Javascript SDK. It provides tools for parsing `.slp` files into structured data and can be used to compute stats. There are already many built-in stats that are computed by the library but the data provided can also be used to compute your own stats.

## Installation

**With NPM**

```bash
npm install @slippi/slippi-js
```

**With Yarn**

```bash
yarn add @slippi/slippi-js
```

## Writing a simple script

1. Create a fresh directory on your disk
2. Inside this new directory, create a file called `script.js`
3. Fill the `script.js` file with the following contents:

```
const { default: SlippiGame } = require('@slippi/slippi-js');

const game = new SlippiGame("test.slp");

// Get game settings – stage, characters, etc
const settings = await game.getSettings();
console.log(settings);

// Get metadata - start time, platform played on, etc
const metadata = await game.getMetadata();
console.log(metadata);

// Get computed stats - openings / kill, conversions, etc
const stats = await game.getStats();
console.log(stats);

// Get frames – animation state, inputs, etc
// This is used to compute your own stats or get more frame-specific info (advanced)
const frames = await game.getFrames();
console.log(frames[0].players); // Print frame when timer starts counting down
```

4. Copy a .slp file into the directory and call it `test.slp`
5. Browse to the directory from the command line and run the command: `npm install @slippi/slippi-js`. This should create a `node_modules` directory in the folder.
6. Run the command: `node script.js`. This will run the script above and will print data about the `test.slp` file

## Reading live files

When using Slippi to mirror gameplay, it can be useful to extract game data about the live game. There are a few different methods of doing this but `slippi-js` can also be used to read live files. It is written in such a way where as long as the same SlippiGame class is used, it will only read from disk the data it has not yet read.

One thing to note, when creating the `SlippiGame` object, be sure to enable `processOnTheFly` to get updated stats as the game progresses.

```javascript
const game = new SlippiGame("path/to/your/slp/file", { processOnTheFly: true });
```

An example script for how to do this is provided as part of this repo here: https://github.com/project-slippi/slippi-js/blob/master/scripts/realtimeFileReads.js

To use the above script, do the following:

1. Open a terminal prompt in the folder containing the script file and the package.json file
2. Run `yarn` to fetch the dependencies
3. Run `node realtimeFileReads.js "C:\mirror\output\path"` replacing the path argument with where your connected console outputs replay files to

At this point, you should see an output as you play games on the connected console.

## Development

### Setup

```bash
git clone https://github.com/project-slippi/slippi-js
cd slippi-js
yarn install
```

### Build

```bash
yarn run build
```

You can also run `yarn run watch` to continuously build whenever changes are detected.

### Test

```bash
yarn run test
```
