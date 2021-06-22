import { EventEmitter } from "events";
import _ from "lodash";

import { FrameEntryType, FramesType, GameStartType, PostFrameUpdateType } from "../types";
import {
  calcDamageTaken,
  ConversionType,
  didLoseStock,
  isCommandGrabbed,
  isDamaged,
  isGrabbed,
  isInControl,
  MoveLandedType,
  Timers,
} from "./common";
import { StatComputer } from "./stats";

interface PlayerConversionState {
  conversion: ConversionType | null;
  move: MoveLandedType | null;
  resetCounter: number;
  lastHitAnimation: number | null;
}

interface MetadataType {
  lastEndFrameByOppIdx: {
    [oppIdx: number]: number;
  };
}

export class ConversionComputer extends EventEmitter implements StatComputer<ConversionType[]> {
  private playerIndices: number[] = [];
  private conversions: ConversionType[] = [];
  private state = new Map<number, PlayerConversionState>();
  private metadata: MetadataType;
  private settings: GameStartType | null = null;

  public constructor() {
    super();
    this.metadata = {
      lastEndFrameByOppIdx: {},
    };
  }

  public setup(settings: GameStartType): void {
    // Reset the state since it's a new game
    this.settings = settings;
    this.playerIndices = settings.players.map((p) => p.playerIndex);
    this.conversions = [];
    this.state = new Map<number, PlayerConversionState>();
    this.metadata = {
      lastEndFrameByOppIdx: {},
    };

    this.playerIndices.forEach((index) => {
      const playerState: PlayerConversionState = {
        conversion: null,
        move: null,
        resetCounter: 0,
        lastHitAnimation: null,
      };
      this.state.set(index, playerState);
    });
  }

  public processFrame(frame: FrameEntryType, allFrames: FramesType): void {
    this.playerIndices.forEach((index) => {
      const state = this.state.get(index);
      if (state) {
        const terminated = handleConversionCompute(allFrames, state, index, frame, this.conversions);
        if (terminated) {
          this.emit("CONVERSION", {
            combo: _.last(this.conversions),
            settings: this.settings,
          });
        }
      }
    });
  }

  public fetch(): ConversionType[] {
    this._populateConversionTypes();
    return this.conversions;
  }

  private _populateConversionTypes(): void {
    // Post-processing step: set the openingTypes
    const conversionsToHandle = _.filter(this.conversions, (conversion) => {
      return conversion.openingType === "unknown";
    });

    // Group new conversions by startTime and sort
    const sortedConversions: ConversionType[][] = _.chain(conversionsToHandle)
      .groupBy("startFrame")
      .orderBy((conversions) => _.get(conversions, [0, "startFrame"]))
      .value();

    // Set the opening types on the conversions we need to handle
    sortedConversions.forEach((conversions) => {
      const isTrade = conversions.length >= 2;
      conversions.forEach((conversion) => {
        // Set end frame for this conversion
        this.metadata.lastEndFrameByOppIdx[conversion.playerIndex] = conversion.endFrame!;

        if (isTrade) {
          // If trade, just short-circuit
          conversion.openingType = "trade";
          return;
        }
        // If not trade, check the player endFrame
        const lastMove = _.last(conversion.moves);
        const playerEndFrame = this.metadata.lastEndFrameByOppIdx[
          lastMove ? lastMove.playerIndex : conversion.playerIndex
        ];
        const isCounterAttack = playerEndFrame && playerEndFrame > conversion.startFrame;
        conversion.openingType = isCounterAttack ? "counter-attack" : "neutral-win";
      });
    });
  }
}

function handleConversionCompute(
  frames: FramesType,
  state: PlayerConversionState,
  playerIndex: number,
  frame: FrameEntryType,
  conversions: ConversionType[],
): boolean {
  const currentFrameNumber = frame.frame;
  const playerFrame: PostFrameUpdateType = frame.players[playerIndex]!.post;

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
  // start a conversion or
  if (playerIsDamaged || playerIsGrabbed || playerIsCommandGrabbed) {
    if (!state.conversion) {
      state.conversion = {
        playerIndex,
        lastHitBy: null,
        startFrame: currentFrameNumber,
        endFrame: null,
        startPercent: prevPlayerFrame ? prevPlayerFrame.percent ?? 0 : 0,
        currentPercent: playerFrame.percent ?? 0,
        endPercent: null,
        moves: [],
        didKill: false,
        openingType: "unknown", // Will be updated later
      };

      conversions.push(state.conversion);
    }

    const playerDamageTaken = prevPlayerFrame ? calcDamageTaken(playerFrame, prevPlayerFrame) : 0;
    const lastHitBy = playerFrame.lastHitBy;
    const validLastHitBy = lastHitBy !== null && lastHitBy >= 0 && lastHitBy <= 3;
    if (playerDamageTaken && lastHitBy !== null && validLastHitBy) {
      // Update who hit us last
      state.conversion.lastHitBy = lastHitBy;

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

        state.conversion.moves.push(state.move);
      }

      if (state.move) {
        state.move.hitCount += 1;
        state.move.damage += playerDamageTaken;
      }

      // Store previous frame animation to consider the case of a trade, the previous
      // frame should always be the move that actually connected... I hope
      state.lastHitAnimation = prevPlayerFrame ? prevPlayerFrame.actionStateId : null;
    }
  }

  if (!state.conversion) {
    // The rest of the function handles conversion termination logic, so if we don't
    // have a conversion started, there is no need to continue
    return false;
  }

  const playerInControl = isInControl(playerActionStateId);
  const playerDidLoseStock = prevPlayerFrame && didLoseStock(playerFrame, prevPlayerFrame);

  // Update percent if the player didn't lose stock
  if (!playerDidLoseStock) {
    state.conversion.currentPercent = playerFrame.percent ?? 0;
  }

  if (playerIsDamaged || playerIsGrabbed || playerIsCommandGrabbed) {
    // If the player got grabbed or damaged, reset the reset counter
    state.resetCounter = 0;
  }

  const shouldStartResetCounter = state.resetCounter === 0 && playerInControl;
  const shouldContinueResetCounter = state.resetCounter > 0;
  if (shouldStartResetCounter || shouldContinueResetCounter) {
    // This will increment the reset timer under the following conditions:
    // 1) if the player is being punishing but they have now entered an actionable state
    // 2) if counter has already started counting meaning the player has entered actionable state
    state.resetCounter += 1;
  }

  let shouldTerminate = false;

  // Termination condition 1 - player was killed
  if (playerDidLoseStock) {
    state.conversion.didKill = true;
    shouldTerminate = true;
  }

  // Termination condition 2 - conversion resets on time
  if (state.resetCounter > Timers.PUNISH_RESET_FRAMES) {
    shouldTerminate = true;
  }

  // If conversion should terminate, mark the end states and add it to list
  if (shouldTerminate) {
    state.conversion.endFrame = playerFrame.frame;
    state.conversion.endPercent = prevPlayerFrame ? prevPlayerFrame.percent ?? 0 : 0;

    state.conversion = null;
    state.move = null;
  }

  return shouldTerminate;
}
