import _ from "lodash";

import { FrameEntryType, GameStartType } from "../types";
import { ActionCountsType, State } from "./common";
import { StatComputer } from "./stats";

// Frame pattern that indicates a dash dance turn was executed
const dashDanceAnimations = [State.DASH, State.TURN, State.DASH];

interface PlayerActionState {
  playerCounts: ActionCountsType;
  animations: number[];
}

export class ActionsComputer implements StatComputer<ActionCountsType[]> {
  private playerIndices: number[] = [];
  private state = new Map<number, PlayerActionState>();

  public setup(settings: GameStartType): void {
    // Reset the state
    this.state = new Map();

    this.playerIndices = settings.players.map((p) => p.playerIndex);
    this.playerIndices.forEach((playerIndex) => {
      const playerCounts: ActionCountsType = {
        playerIndex,
        wavedashCount: 0,
        wavelandCount: 0,
        airDodgeCount: 0,
        dashDanceCount: 0,
        spotDodgeCount: 0,
        ledgegrabCount: 0,
        rollCount: 0,
        lCancelCount: {
          success: 0,
          fail: 0,
        },
        grabCount: {
          success: 0,
          fail: 0,
        },
        throwCount: {
          up: 0,
          forward: 0,
          back: 0,
          down: 0,
        },
        groundTechCount: {
          backward: 0,
          forward: 0,
          neutral: 0,
          fail: 0,
        },
        wallTechCount: {
          success: 0,
          fail: 0,
        },
      };
      const playerState: PlayerActionState = {
        playerCounts: playerCounts,
        animations: [],
      };
      this.state.set(playerIndex, playerState);
    });
  }

  public processFrame(frame: FrameEntryType): void {
    this.playerIndices.forEach((index) => {
      const state = this.state.get(index);
      if (state) {
        handleActionCompute(state, index, frame);
      }
    });
  }

  public fetch(): ActionCountsType[] {
    return Array.from(this.state.values()).map((val) => val.playerCounts);
  }
}

function didMissGroundTech(animation: State): boolean {
  return animation === State.TECH_MISS_DOWN || animation === State.TECH_MISS_UP;
}

function isRolling(animation: State): boolean {
  return animation === State.ROLL_BACKWARD || animation === State.ROLL_FORWARD;
}

function didStartRoll(currentAnimation: number, previousAnimation: number): boolean {
  const isCurrentlyRolling = isRolling(currentAnimation);
  const wasPreviouslyRolling = isRolling(previousAnimation);

  return isCurrentlyRolling && !wasPreviouslyRolling;
}

function isSpotDodging(animation: State): boolean {
  return animation === State.SPOT_DODGE;
}

function didStartGrabSuccess(currentAnimation: State, previousAnimation: State): boolean {
  return previousAnimation === State.GRAB && currentAnimation <= State.GRAB_WAIT && currentAnimation > State.GRAB;
}
function didStartGrabFail(currentAnimation: State, previousAnimation: State): boolean {
  return previousAnimation === State.GRAB && (currentAnimation > State.GRAB_WAIT || currentAnimation < State.GRAB);
}

function didStartSpotDodge(currentAnimation: State, previousAnimation: State): boolean {
  const isCurrentlyDodging = isSpotDodging(currentAnimation);
  const wasPreviouslyDodging = isSpotDodging(previousAnimation);

  return isCurrentlyDodging && !wasPreviouslyDodging;
}

function isAirDodging(animation: State): boolean {
  return animation === State.AIR_DODGE;
}

function didStartAirDodge(currentAnimation: State, previousAnimation: State): boolean {
  const isCurrentlyDodging = isAirDodging(currentAnimation);
  const wasPreviouslyDodging = isAirDodging(previousAnimation);

  return isCurrentlyDodging && !wasPreviouslyDodging;
}

function isGrabbingLedge(animation: State): boolean {
  return animation === State.CLIFF_CATCH;
}

function isAerialAttack(animation: State): boolean {
  return animation >= State.AERIAL_ATTACK_START && animation <= State.AERIAL_ATTACK_END;
}

function didStartLedgegrab(currentAnimation: State, previousAnimation: State): boolean {
  const isCurrentlyGrabbingLedge = isGrabbingLedge(currentAnimation);
  const wasPreviouslyGrabbingLedge = isGrabbingLedge(previousAnimation);

  return isCurrentlyGrabbingLedge && !wasPreviouslyGrabbingLedge;
}

function handleActionCompute(state: PlayerActionState, playerIndex: number, frame: FrameEntryType): void {
  const playerFrame = frame.players[playerIndex]!.post;
  const incrementCount = (field: string, condition: boolean): void => {
    if (!condition) {
      return;
    }

    _.update(state.playerCounts, field, (n) => n + 1);
  };

  // Manage animation state
  const currentAnimation = playerFrame.actionStateId!;
  state.animations.push(currentAnimation);

  // Grab last 3 frames
  const last3Frames = state.animations.slice(-3);
  const prevAnimation = last3Frames[last3Frames.length - 2];
  const newAnimation = currentAnimation !== prevAnimation;

  // Increment counts based on conditions
  const didDashDance = _.isEqual(last3Frames, dashDanceAnimations);
  incrementCount("dashDanceCount", didDashDance);

  const didRoll = didStartRoll(currentAnimation, prevAnimation);
  incrementCount("rollCount", didRoll);

  const didSpotDodge = didStartSpotDodge(currentAnimation, prevAnimation);
  incrementCount("spotDodgeCount", didSpotDodge);

  const didAirDodge = didStartAirDodge(currentAnimation, prevAnimation);
  incrementCount("airDodgeCount", didAirDodge);

  const didGrabLedge = didStartLedgegrab(currentAnimation, prevAnimation);
  incrementCount("ledgegrabCount", didGrabLedge);

  const didGrabSucceed = didStartGrabSuccess(currentAnimation, prevAnimation);
  incrementCount("grabCount.success", didGrabSucceed);
  const didGrabFail = didStartGrabFail(currentAnimation, prevAnimation);
  incrementCount("grabCount.fail", didGrabFail);

  incrementCount("throwCount.up", currentAnimation === State.THROW_UP && newAnimation);
  incrementCount("throwCount.forward", currentAnimation === State.THROW_FORWARD && newAnimation);
  incrementCount("throwCount.down", currentAnimation === State.THROW_DOWN && newAnimation);
  incrementCount("throwCount.back", currentAnimation === State.THROW_BACK && newAnimation);

  if (newAnimation) {
    const didMissTech = didMissGroundTech(currentAnimation);
    incrementCount("groundTechCount.fail", didMissTech);
    incrementCount("groundTechCount.forward", currentAnimation === State.FORWARD_TECH);
    incrementCount("groundTechCount.neutral", currentAnimation === State.NEUTRAL_TECH);
    incrementCount("groundTechCount.backward", currentAnimation === State.BACKWARD_TECH);

    incrementCount("wallTechCount.success", currentAnimation === State.WALL_TECH);
    incrementCount("wallTechCount.fail", currentAnimation === State.MISSED_WALL_TECH);
  }

  if (isAerialAttack(currentAnimation)) {
    incrementCount("lCancelCount.success", playerFrame.lCancelStatus === 1);
    incrementCount("lCancelCount.fail", playerFrame.lCancelStatus === 2);
  }

  // Handles wavedash detection (and waveland)
  handleActionWavedash(state.playerCounts, state.animations);
}

function handleActionWavedash(counts: ActionCountsType, animations: State[]): void {
  const currentAnimation = _.last(animations);
  const prevAnimation = animations[animations.length - 2];

  const isSpecialLanding = currentAnimation === State.LANDING_FALL_SPECIAL;
  const isAcceptablePrevious = isWavedashInitiationAnimation(prevAnimation);
  const isPossibleWavedash = isSpecialLanding && isAcceptablePrevious;

  if (!isPossibleWavedash) {
    return;
  }

  // Here we special landed, it might be a wavedash, let's check
  // We grab the last 8 frames here because that should be enough time to execute a
  // wavedash. This number could be tweaked if we find false negatives
  const recentFrames = animations.slice(-8);
  const recentAnimations = _.keyBy(recentFrames, (animation) => animation);

  if (_.size(recentAnimations) === 2 && recentAnimations[State.AIR_DODGE]) {
    // If the only other animation is air dodge, this might be really late to the point
    // where it was actually an air dodge. Air dodge animation is really long
    return;
  }

  if (recentAnimations[State.AIR_DODGE]) {
    // If one of the recent animations was an air dodge, let's remove that from the
    // air dodge counter, we don't want to count air dodges used to wavedash/land
    counts.airDodgeCount -= 1;
  }

  if (recentAnimations[State.ACTION_KNEE_BEND]) {
    // If a jump was started recently, we will consider this a wavedash
    counts.wavedashCount += 1;
  } else {
    // If there was no jump recently, this is a waveland
    counts.wavelandCount += 1;
  }
}

function isWavedashInitiationAnimation(animation: State): boolean {
  if (animation === State.AIR_DODGE) {
    return true;
  }

  const isAboveMin = animation >= State.CONTROLLED_JUMP_START;
  const isBelowMax = animation <= State.CONTROLLED_JUMP_END;
  return isAboveMin && isBelowMax;
}
