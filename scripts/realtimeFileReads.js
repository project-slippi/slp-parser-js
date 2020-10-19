const { default: SlippiGame } = require("@slippi/slippi-js");
const chokidar = require("chokidar");
const _ = require("lodash");

const listenPath = process.argv[2];
console.log(`Listening at: ${listenPath}`);

const watcher = chokidar.watch(listenPath, {
  ignored: "!*.slp", // TODO: This doesn't work. Use regex?
  depth: 0,
  persistent: true,
  usePolling: true,
  ignoreInitial: true,
});

const gameByPath = {};
watcher.on("change", async (path) => {
  const start = Date.now();

  let gameState, settings, stats, frames, latestFrame, gameEnd;
  try {
    let game = _.get(gameByPath, [path, "game"]);
    if (!game) {
      console.log(`New file at: ${path}`);
      // Make sure to enable `processOnTheFly` to get updated stats as the game progresses
      game = new SlippiGame(path, { processOnTheFly: true });
      gameByPath[path] = {
        game: game,
        state: {
          settings: null,
          detectedPunishes: {},
        },
      };
    }

    gameState = _.get(gameByPath, [path, "state"]);

    settings = await game.getSettings();

    // You can uncomment the stats calculation below to get complex stats in real-time. The problem
    // is that these calculations have not been made to operate only on new data yet so as
    // the game gets longer, the calculation will take longer and longer
    // stats = await game.getStats();

    frames = await game.getFrames();
    latestFrame = await game.getLatestFrame();
    gameEnd = await game.getGameEnd();
  } catch (err) {
    console.log(err);
    return;
  }

  if (!gameState.settings && settings) {
    console.log(`[Game Start] New game has started`);
    console.log(settings);
    gameState.settings = settings;
  }

  console.log(`We have ${_.size(frames)} frames.`);
  _.forEach(settings.players, (player) => {
    const frameData = _.get(latestFrame, ["players", player.playerIndex]);
    if (!frameData) {
      return;
    }

    console.log(
      `[Port ${player.port}] ${frameData.post.percent.toFixed(1)}% | ` + `${frameData.post.stocksRemaining} stocks`,
    );
  });

  // Uncomment this if you uncomment the stats calculation above. See comment above for details
  // // Do some conversion detection logging
  // // console.log(stats);
  // _.forEach(stats.conversions, conversion => {
  //   const key = `${conversion.playerIndex}-${conversion.startFrame}`;
  //   const detected = _.get(gameState, ['detectedPunishes', key]);
  //   if (!detected) {
  //     console.log(`[Punish Start] Frame ${conversion.startFrame} by player ${conversion.playerIndex + 1}`);
  //     gameState.detectedPunishes[key] = conversion;
  //     return;
  //   }

  //   // If punish was detected previously, but just ended, let's output that
  //   if (!detected.endFrame && conversion.endFrame) {
  //     const dmg = conversion.endPercent - conversion.startPercent;
  //     const dur = conversion.endFrame - conversion.startFrame;
  //     console.log(
  //       `[Punish End] Player ${conversion.playerIndex + 1}'s punish did ${dmg} damage ` +
  //       `with ${conversion.moves.length} moves over ${dur} frames`
  //     );
  //   }

  //   gameState.detectedPunishes[key] = conversion;
  // });

  if (gameEnd) {
    // NOTE: These values and the quitter index will not work until 2.0.0 recording code is
    // NOTE: used. This code has not been publicly released yet as it still has issues
    const endTypes = {
      1: "TIME!",
      2: "GAME!",
      7: "No Contest",
    };

    const endMessage = _.get(endTypes, gameEnd.gameEndMethod) || "Unknown";

    const lrasText = gameEnd.gameEndMethod === 7 ? ` | Quitter Index: ${gameEnd.lrasInitiatorIndex}` : "";
    console.log(`[Game Complete] Type: ${endMessage}${lrasText}`);
  }

  console.log(`Read took: ${Date.now() - start} ms`);
});
