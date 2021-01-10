// @flow
import _ from "lodash";
import { State, PlayerIndexedType, ActionCountsType } from "./common";
import { FrameEntryType } from "../types";
import { StatComputer } from "./stats";

// Frame pattern that indicates a dash dance turn was executed
const dashDanceAnimations = [State.DASH, State.TURN, State.DASH];

interface PlayerActionState {
  playerCounts: ActionCountsType;
  animations: number[];
}

export class ActionsComputer implements StatComputer<ActionCountsType[]> {
  private playerPermutations = new Array<PlayerIndexedType>();
  private state = new Map<PlayerIndexedType, PlayerActionState>();

  public setPlayerPermutations(playerPermutations: PlayerIndexedType[]): void {
    this.playerPermutations = playerPermutations;
    this.playerPermutations.forEach((indices) => {
      const playerCounts: ActionCountsType = {
        playerIndex: indices.playerIndex,
        opponentIndex: indices.opponentIndex,
        wavedashCount: 0,
        wavelandCount: 0,
        airDodgeCount: 0,
        dashDanceCount: 0,
        spotDodgeCount: 0,
        ledgegrabCount: 0,
        rollCount: 0,
      };
      const playerState: PlayerActionState = {
        playerCounts: playerCounts,
        animations: [],
      };
      this.state.set(indices, playerState);
    });
  }

  public processFrame(frame: FrameEntryType): void {
    this.playerPermutations.forEach((indices) => {
      const state = this.state.get(indices);
      handleActionCompute(state, indices, frame);
    });
  }

  public fetch(): ActionCountsType[] {
    return Array.from(this.state.keys()).map((key) => this.state.get(key).playerCounts);
  }
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

function didStartLedgegrab(currentAnimation: State, previousAnimation: State): boolean {
  const isCurrentlyGrabbingLedge = isGrabbingLedge(currentAnimation);
  const wasPreviouslyGrabbingLedge = isGrabbingLedge(previousAnimation);

  return isCurrentlyGrabbingLedge && !wasPreviouslyGrabbingLedge;
}

function handleActionCompute(state: PlayerActionState, indices: PlayerIndexedType, frame: FrameEntryType): void {
  const playerFrame = frame.players[indices.playerIndex].post;

  // Manage animation state
  state.animations.push(playerFrame.actionStateId);

  // Grab last 3 frames
  const last3Frames = state.animations.slice(-3);
  const currentAnimation = playerFrame.actionStateId;
  const prevAnimation = last3Frames[last3Frames.length - 2];

  // Increment counts based on conditions
  const playerCounts = state.playerCounts;
  if (_.isEqual(last3Frames, dashDanceAnimations)) {
    playerCounts.dashDanceCount++;
  }
  if (didStartRoll(currentAnimation, prevAnimation)) {
    playerCounts.rollCount++;
  }
  if (didStartSpotDodge(currentAnimation, prevAnimation)) {
    playerCounts.spotDodgeCount++;
  }
  if (didStartAirDodge(currentAnimation, prevAnimation)) {
    playerCounts.airDodgeCount++;
  }
  if (didStartLedgegrab(currentAnimation, prevAnimation)) {
    playerCounts.ledgegrabCount++;
  }

  // Handles wavedash detection (and waveland)
  handleActionWavedash(playerCounts, state.animations);
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
