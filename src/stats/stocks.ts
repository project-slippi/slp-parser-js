import _ from "lodash";

import { FrameEntryType, FramesType, GameStartType } from "../types";
import { didLoseStock, isDead, StockType } from "./common";
import { StatComputer } from "./stats";

interface StockState {
  stock?: StockType | null;
}

export class StockComputer implements StatComputer<StockType[]> {
  private state = new Map<number, StockState>();
  private playerIndices: number[] = [];
  private stocks: StockType[] = [];

  public setup(settings: GameStartType): void {
    // Reset the state since it's a new game
    this.state = new Map();
    this.playerIndices = settings.players.map((p) => p.playerIndex);
    this.stocks = [];

    this.playerIndices.forEach((index) => {
      const playerState: StockState = {
        stock: null,
      };
      this.state.set(index, playerState);
    });
  }

  public processFrame(frame: FrameEntryType, allFrames: FramesType): void {
    this.playerIndices.forEach((index) => {
      const state = this.state.get(index);
      if (state) {
        handleStockCompute(allFrames, state, index, frame, this.stocks);
      }
    });
  }

  public fetch(): StockType[] {
    return this.stocks;
  }
}

function handleStockCompute(
  frames: FramesType,
  state: StockState,
  playerIndex: number,
  frame: FrameEntryType,
  stocks: StockType[],
): void {
  const playerFrame = frame.players[playerIndex]!.post;
  const currentFrameNumber = playerFrame.frame!;
  const prevFrameNumber = currentFrameNumber - 1;
  const prevPlayerFrame = frames[prevFrameNumber] ? frames[prevFrameNumber].players[playerIndex]!.post : null;

  // If there is currently no active stock, wait until the player is no longer spawning.
  // Once the player is no longer spawning, start the stock
  if (!state.stock) {
    const isPlayerDead = isDead(playerFrame.actionStateId!);
    if (isPlayerDead) {
      return;
    }

    state.stock = {
      playerIndex,
      startFrame: currentFrameNumber,
      endFrame: null,
      startPercent: 0,
      endPercent: null,
      currentPercent: 0,
      count: playerFrame.stocksRemaining!,
      deathAnimation: null,
    };

    stocks.push(state.stock);
  } else if (prevPlayerFrame && didLoseStock(playerFrame, prevPlayerFrame)) {
    state.stock.endFrame = playerFrame.frame;
    state.stock.endPercent = prevPlayerFrame.percent ?? 0;
    state.stock.deathAnimation = playerFrame.actionStateId;
    state.stock = null;
  } else {
    state.stock.currentPercent = playerFrame.percent ?? 0;
  }
}
