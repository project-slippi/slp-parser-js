import _ from 'lodash';
import { PostFrameUpdateType, GameStartType, PreFrameUpdateType, ItemUpdateType } from "../utils/slpReader";

export type FrameEntryType = {
  frame: number;
  players: { [playerIndex: number]: {
    pre: PreFrameUpdateType;
    post: PostFrameUpdateType;
  };};
  followers: { [playerIndex: number]: {
    pre: PreFrameUpdateType;
    post: PostFrameUpdateType;
  };};
  items: ItemUpdateType[];
};

export type FramesType = {
  [frameIndex: number]: FrameEntryType;
};

export type StatsType = {
  gameComplete: boolean;
  lastFrame: number;
  playableFrameCount: number;
  stocks: StockType[];
  conversions: ConversionType[];
  combos: ComboType[];
  actionCounts: ActionCountsType[];
  overall: OverallType[];
};

export type RatioType = {
  count: number;
  total: number;
  ratio: number | null;
};

export type PlayerIndexedType = {
  playerIndex: number;
  opponentIndex: number;
};

export type DurationType = {
  startFrame: number;
  endFrame: number | null | undefined;
};

export type DamageType = {
  startPercent: number;
  currentPercent: number;
  endPercent: number | null | undefined;
};

export type StockType = PlayerIndexedType & DurationType & DamageType & {
  count: number;
  deathAnimation: number | null | undefined;
};

export type MoveLandedType = {
  frame: number;
  moveId: number;
  hitCount: number;
  damage: number;
};

export type ConversionType = PlayerIndexedType & DurationType & DamageType & {
  moves: MoveLandedType[];
  openingType: string;
  didKill: boolean;
};

export type ComboType = PlayerIndexedType & DurationType & DamageType & {
  moves: MoveLandedType[];
  didKill: boolean;
  interactiveOpponent: boolean | null;
  opponentInputs: boolean[];
};

export type ActionCountsType = PlayerIndexedType & {
  wavedashCount: number;
  wavelandCount: number;
  airDodgeCount: number;
  dashDanceCount: number;
  spotDodgeCount: number;
  ledgegrabCount: number;
  rollCount: number;
};

export type OverallType = PlayerIndexedType & {
  inputCount: number;
  conversionCount: number;
  totalDamage: number;
  killCount: number;
  successfulConversions: RatioType;
  inputsPerMinute: RatioType;
  openingsPerKill: RatioType;
  damagePerOpening: RatioType;
  neutralWinRatio: RatioType;
  counterHitRatio: RatioType;
  beneficialTradeRatio: RatioType;
};

export enum State {
  // Animation ID ranges
  DAMAGE_START = 0x4B,
  DAMAGE_END = 0x5B,
  CAPTURE_START = 0xDF,
  CAPTURE_END = 0xE8,
  GUARD_START = 0xB2,
  GUARD_END = 0xB6,
  GROUNDED_CONTROL_START = 0xE,
  GROUNDED_CONTROL_END = 0x18,
  SQUAT_START = 0x27,
  SQUAT_END = 0x29,
  DOWN_START = 0xB7,
  DOWN_END = 0xC6,
  TECH_START = 0xC7,
  TECH_END = 0xCC,
  DYING_START = 0x0,
  DYING_END = 0xA,
  CONTROLLED_JUMP_START = 0x18,
  CONTROLLED_JUMP_END = 0x22,
  GROUND_ATTACK_START = 0x2C,
  GROUND_ATTACK_END = 0x40,

  // Animation ID specific
  ROLL_FORWARD = 0xE9,
  ROLL_BACKWARD = 0xEA,
  SPOT_DODGE = 0xEB,
  AIR_DODGE = 0xEC,
  ACTION_WAIT = 0xE,
  ACTION_DASH = 0x14,
  ACTION_KNEE_BEND = 0x18,
  GUARD_ON = 0xB2,
  TECH_MISS_UP = 0xB7,
  TECH_MISS_DOWN = 0xBF,
  DASH = 0x14,
  TURN = 0x12,
  LANDING_FALL_SPECIAL = 0x2B,
  JUMP_FORWARD = 0x19,
  JUMP_BACKWARD = 0x1A,
  FALL_FORWARD = 0x1E,
  FALL_BACKWARD = 0x1F,
  GRAB = 0xD4,
  CLIFF_CATCH = 0xFC,
};

export const Timers = {
  PUNISH_RESET_FRAMES: 45,
  RECOVERY_RESET_FRAMES: 45,
  COMBO_STRING_RESET_FRAMES: 45,
};

export const Frames = {
  FIRST: -123,
  FIRST_PLAYABLE: -39,
};

export function getSinglesPlayerPermutationsFromSettings(settings: GameStartType): PlayerIndexedType[] {
  if (!settings || settings.players.length !== 2) {
    // Only return opponent indices for singles
    return [];
  }

  return [
    {
      playerIndex: settings.players[0].playerIndex,
      opponentIndex: settings.players[1].playerIndex
    }, {
      playerIndex: settings.players[1].playerIndex,
      opponentIndex: settings.players[0].playerIndex
    }
  ];
}

export function didLoseStock(frame: PostFrameUpdateType, prevFrame: PostFrameUpdateType): boolean {
  if (!frame || !prevFrame) {
    return false;
  }

  return (prevFrame.stocksRemaining - frame.stocksRemaining) > 0;
}

export function isInControl(state: number): boolean {
  const ground = state >= State.GROUNDED_CONTROL_START && state <= State.GROUNDED_CONTROL_END;
  const squat = state >= State.SQUAT_START && state <= State.SQUAT_END;
  const groundAttack = state > State.GROUND_ATTACK_START && state <= State.GROUND_ATTACK_END;
  const isGrab = state === State.GRAB;
  // TODO: Add grounded b moves?
  return ground || squat || groundAttack || isGrab;
}

export function isTeching(state: number): boolean {
  return state >= State.TECH_START && state <= State.TECH_END;
}

export function isDown(state: number): boolean {
  return state >= State.DOWN_START && state <= State.DOWN_END;
}

export function isDamaged(state: number): boolean {
  return state >= State.DAMAGE_START && state <= State.DAMAGE_END;
}

export function isGrabbed(state: number): boolean {
  return state >= State.CAPTURE_START && state <= State.CAPTURE_END;
}

export function isDead(state: number): boolean {
  return state >= State.DYING_START && state <= State.DYING_END;
}

export function calcDamageTaken(frame: PostFrameUpdateType, prevFrame: PostFrameUpdateType): number {
  const percent = _.get(frame, 'percent', 0);
  const prevPercent = _.get(prevFrame, 'percent', 0);

  return percent - prevPercent;
}

export function isInputting(frame: PreFrameUpdateType, prevFrame: PreFrameUpdateType): boolean {
  const inputKeys = ['buttons', 'joystickX', 'joystickY', 'cStickX', 'cStickY', 'trigger'];
  const currentInputs = _.pick(frame, inputKeys);
  const prevInputs = _.pick(prevFrame, inputKeys);
  return !_.isEqual(currentInputs, prevInputs);
}