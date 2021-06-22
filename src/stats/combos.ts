import { EventEmitter } from "events";
import { last } from "lodash";

import { FrameEntryType, FramesType, GameStartType, PostFrameUpdateType } from "../types";
import {
  calcDamageTaken,
  ComboType,
  didLoseStock,
  isCommandGrabbed,
  isDamaged,
  isDead,
  isDown,
  isGrabbed,
  isTeching,
  MoveLandedType,
  Timers,
} from "./common";
import { StatComputer } from "./stats";

export enum ComboEvent {
  COMBO_START = "COMBO_START",
  COMBO_EXTEND = "COMBO_EXTEND",
  COMBO_END = "COMBO_END",
}

interface ComboState {
  combo: ComboType | null;
  move: MoveLandedType | null;
  resetCounter: number;
  lastHitAnimation: number | null;
  event: ComboEvent | null;
}

export class ComboComputer extends EventEmitter implements StatComputer<ComboType[]> {
  private playerIndices: number[] = [];
  private combos: ComboType[] = [];
  private state = new Map<number, ComboState>();
  private settings: GameStartType | null = null;

  public setup(settings: GameStartType): void {
    // Reset the state
    this.settings = settings;
    this.state = new Map();
    this.combos = [];

    this.playerIndices = settings.players.map((p) => p.playerIndex);
    this.playerIndices.forEach((indices) => {
      const playerState: ComboState = {
        combo: null,
        move: null,
        resetCounter: 0,
        lastHitAnimation: null,
        event: null,
      };
      this.state.set(indices, playerState);
    });
  }

  public processFrame(frame: FrameEntryType, allFrames: FramesType): void {
    this.playerIndices.forEach((index) => {
      const state = this.state.get(index);
      if (state) {
        handleComboCompute(allFrames, state, index, frame, this.combos);

        // Emit an event for the new combo
        if (state.event !== null) {
          this.emit(state.event, {
            combo: last(this.combos),
            settings: this.settings,
          });
          state.event = null;
        }
      }
    });
  }

  public fetch(): ComboType[] {
    return this.combos;
  }
}

function handleComboCompute(
  frames: FramesType,
  state: ComboState,
  playerIndex: number,
  frame: FrameEntryType,
  combos: ComboType[],
): void {
  const currentFrameNumber = frame.frame;
  const playerFrame = frame.players[playerIndex]!.post;

  const prevFrameNumber = currentFrameNumber - 1;
  let prevPlayerFrame: PostFrameUpdateType | null = null;

  if (frames[prevFrameNumber]) {
    prevPlayerFrame = frames[prevFrameNumber].players[playerIndex]!.post;
  }

  // Keep track of whether actionState changes after a hit. Used to compute move count
  // When purely using action state there was a bug where if you did two of the same
  // move really fast (such as ganon's jab), it would count as one move. Added
  // the actionStateCounter at this point which counts the number of frames since
  // an animation started. Should be more robust, for old files it should always be
  // null and null < null = false
  const actionChangedSinceHit = playerFrame.actionStateId !== state.lastHitAnimation;
  const actionCounter = playerFrame.actionStateCounter!;
  const prevActionCounter = prevPlayerFrame ? prevPlayerFrame.actionStateCounter! : 0;
  const actionFrameCounterReset = actionCounter < prevActionCounter;
  if (actionChangedSinceHit || actionFrameCounterReset) {
    state.lastHitAnimation = null;
  }

  const playerActionStateId = playerFrame.actionStateId!;
  const playerIsDamaged = isDamaged(playerActionStateId);
  const playerIsGrabbed = isGrabbed(playerActionStateId);
  const playerIsCommandGrabbed = isCommandGrabbed(playerActionStateId);

  // If the player took damage and was put in some kind of stun this frame, either
  // start a combo or count the moves for the existing combo
  if (playerIsDamaged || playerIsGrabbed || playerIsCommandGrabbed) {
    let comboStarted = false;

    if (!state.combo) {
      state.combo = {
        playerIndex,
        startFrame: currentFrameNumber,
        endFrame: null,
        startPercent: prevPlayerFrame ? prevPlayerFrame.percent ?? 0 : 0,
        currentPercent: playerFrame.percent ?? 0,
        endPercent: null,
        moves: [],
        didKill: false,
        lastHitBy: null,
      };

      combos.push(state.combo);

      // Track whether this is a new combo or not
      comboStarted = true;
    }

    const playerDamageTaken = prevPlayerFrame ? calcDamageTaken(playerFrame, prevPlayerFrame) : 0;
    const lastHitBy = playerFrame.lastHitBy;
    const validLastHitBy = lastHitBy !== null && lastHitBy >= 0 && lastHitBy <= 3;
    if (playerDamageTaken && lastHitBy !== null && validLastHitBy) {
      // Update who hit us last
      state.combo.lastHitBy = lastHitBy;

      // If animation of last hit has been cleared that means this is a new move. This
      // prevents counting multiple hits from the same move such as fox's drill
      if (state.lastHitAnimation === null) {
        state.move = {
          playerIndex: lastHitBy,
          frame: currentFrameNumber,
          moveId: frame.players[lastHitBy]!.post!.lastAttackLanded!,
          hitCount: 0,
          damage: 0,
        };

        state.combo.moves.push(state.move);

        // Make sure we don't overwrite the START event
        if (!comboStarted) {
          state.event = ComboEvent.COMBO_EXTEND;
        }
      }

      if (state.move) {
        state.move.hitCount += 1;
        state.move.damage += playerDamageTaken;
      }

      // Store previous frame animation to consider the case of a trade, the previous
      // frame should always be the move that actually connected... I hope
      state.lastHitAnimation = prevPlayerFrame ? prevPlayerFrame.actionStateId : null;
    }

    if (comboStarted) {
      state.event = ComboEvent.COMBO_START;
    }
  }

  if (!state.combo) {
    // The rest of the function handles combo termination logic, so if we don't
    // have a combo started, there is no need to continue
    return;
  }

  const playerIsTeching = isTeching(playerActionStateId);
  const playerIsDowned = isDown(playerActionStateId);
  const playerDidLoseStock = prevPlayerFrame && didLoseStock(playerFrame, prevPlayerFrame);
  const playerIsDying = isDead(playerActionStateId);

  // Update percent if the player didn't lose stock
  if (!playerDidLoseStock) {
    state.combo.currentPercent = playerFrame.percent ?? 0;
  }

  if (
    playerIsDamaged ||
    playerIsGrabbed ||
    playerIsCommandGrabbed ||
    playerIsTeching ||
    playerIsDowned ||
    playerIsDying
  ) {
    // If the player got grabbed or damaged, reset the reset counter
    state.resetCounter = 0;
  } else {
    state.resetCounter += 1;
  }

  let shouldTerminate = false;

  // Termination condition 1 - player was killed
  if (playerDidLoseStock) {
    state.combo.didKill = true;
    shouldTerminate = true;
  }

  // Termination condition 2 - combo resets on time
  if (state.resetCounter > Timers.COMBO_STRING_RESET_FRAMES) {
    shouldTerminate = true;
  }

  // If combo should terminate, mark the end states and add it to list
  if (shouldTerminate) {
    state.combo.endFrame = playerFrame.frame;
    state.combo.endPercent = prevPlayerFrame ? prevPlayerFrame.percent ?? 0 : 0;
    state.event = ComboEvent.COMBO_END;

    state.combo = null;
    state.move = null;
  }
}
