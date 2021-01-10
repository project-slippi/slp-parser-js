// @flow
import _ from "lodash";

import { isDead, didLoseStock, PlayerIndexedType, StockType } from "./common";
import { FrameEntryType, FramesType, PostFrameUpdateType } from "../types";
import { StatComputer } from "./stats";

interface StockState {
  stock?: StockType | null;
}

export class StockComputer implements StatComputer<StockType[]> {
  private state = new Map<PlayerIndexedType, StockState>();
  private playerPermutations = new Array<PlayerIndexedType>();
  private stocks = new Array<StockType>();

  public setPlayerPermutations(playerPermutations: PlayerIndexedType[]): void {
    this.playerPermutations = playerPermutations;
    this.playerPermutations.forEach((indices) => {
      const playerState: StockState = {
        stock: null,
      };
      this.state.set(indices, playerState);
    });
  }

  public processFrame(frame: FrameEntryType, allFrames: FramesType): void {
    this.playerPermutations.forEach((indices) => {
      const state = this.state.get(indices);
      handleStockCompute(allFrames, state, indices, frame, this.stocks);
    });
  }

  public fetch(): StockType[] {
    return this.stocks;
  }
}

function handleStockCompute(
  frames: FramesType,
  state: StockState,
  indices: PlayerIndexedType,
  frame: FrameEntryType,
  stocks: StockType[],
): void {
  const playerFrame = frame.players[indices.playerIndex].post;
  const prevPlayerFrame: PostFrameUpdateType = _.get(frames, [
    playerFrame.frame - 1,
    "players",
    indices.playerIndex,
    "post",
  ]);

  // If there is currently no active stock, wait until the player is no longer spawning.
  // Once the player is no longer spawning, start the stock
  if (!state.stock) {
    const isPlayerDead = isDead(playerFrame.actionStateId);
    if (isPlayerDead) {
      return;
    }

    state.stock = {
      playerIndex: indices.playerIndex,
      opponentIndex: indices.opponentIndex,
      startFrame: playerFrame.frame,
      endFrame: null,
      startPercent: 0,
      endPercent: null,
      currentPercent: 0,
      count: playerFrame.stocksRemaining,
      deathAnimation: null,
    };

    stocks.push(state.stock);
  } else if (didLoseStock(playerFrame, prevPlayerFrame)) {
    state.stock.endFrame = playerFrame.frame;
    state.stock.endPercent = prevPlayerFrame.percent || 0;
    state.stock.deathAnimation = playerFrame.actionStateId;
    state.stock = null;
  } else {
    state.stock.currentPercent = playerFrame.percent || 0;
  }
}
