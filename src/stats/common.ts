import _ from "lodash";
import { PostFrameUpdateType, GameStartType } from "../types";

export interface StatsType {
  gameComplete: boolean;
  lastFrame: number;
  playableFrameCount: number;
  stocks: StockType[];
  conversions: ConversionType[];
  combos: ComboType[];
  actionCounts: ActionCountsType[];
  overall: OverallType[];
}

export interface RatioType {
  count: number;
  total: number;
  ratio: number | null;
}

export interface PlayerIndexedType {
  playerIndex: number;
  opponentIndex: number;
}

export interface DurationType {
  startFrame: number;
  endFrame?: number | null;
}

export interface DamageType {
  startPercent: number;
  currentPercent: number;
  endPercent?: number | null;
}

export interface StockType extends PlayerIndexedType, DurationType, DamageType {
  count: number;
  deathAnimation?: number | null;
}

export interface MoveLandedType {
  frame: number;
  moveId: number;
  hitCount: number;
  damage: number;
}

export interface ConversionType extends PlayerIndexedType, DurationType, DamageType {
  moves: MoveLandedType[];
  openingType: string;
  didKill: boolean;
}

export interface ComboType extends PlayerIndexedType, DurationType, DamageType {
  moves: MoveLandedType[];
  didKill: boolean;
}

export interface ActionCountsType extends PlayerIndexedType {
  wavedashCount: number;
  wavelandCount: number;
  airDodgeCount: number;
  dashDanceCount: number;
  spotDodgeCount: number;
  ledgegrabCount: number;
  rollCount: number;
  lCancelSuccessCount: number;
  lCancelFailCount: number;
}

export interface InputCountsType {
  buttons: number;
  triggers: number;
  joystick: number;
  cstick: number;
  total: number;
}

export interface AnalogMotionType {
  distanceTraveled: number;
  metersTraveled: number;
  analogMotionFrameCount: number;
  averageVelocity: RatioType;
}

export interface OverallType extends PlayerIndexedType {
  inputCounts: InputCountsType;
  conversionCount: number;
  totalDamage: number;
  killCount: number;
  successfulConversions: RatioType;
  inputsPerMinute: RatioType;
  digitalInputsPerMinute: RatioType;
  joystickMotion: AnalogMotionType;
  openingsPerKill: RatioType;
  damagePerOpening: RatioType;
  neutralWinRatio: RatioType;
  counterHitRatio: RatioType;
  beneficialTradeRatio: RatioType;
}

export enum State {
  // Animation ID ranges
  DAMAGE_START = 0x4b,
  DAMAGE_END = 0x5b,
  CAPTURE_START = 0xdf,
  CAPTURE_END = 0xe8,
  GUARD_START = 0xb2,
  GUARD_END = 0xb6,
  GROUNDED_CONTROL_START = 0xe,
  GROUNDED_CONTROL_END = 0x18,
  SQUAT_START = 0x27,
  SQUAT_END = 0x29,
  DOWN_START = 0xb7,
  DOWN_END = 0xc6,
  TECH_START = 0xc7,
  TECH_END = 0xcc,
  DYING_START = 0x0,
  DYING_END = 0xa,
  CONTROLLED_JUMP_START = 0x18,
  CONTROLLED_JUMP_END = 0x22,
  GROUND_ATTACK_START = 0x2c,
  GROUND_ATTACK_END = 0x40,
  AERIAL_ATTACK_START = 0x41,
  AERIAL_ATTACK_END = 0x4a,

  // Animation ID specific
  ROLL_FORWARD = 0xe9,
  ROLL_BACKWARD = 0xea,
  SPOT_DODGE = 0xeb,
  AIR_DODGE = 0xec,
  ACTION_WAIT = 0xe,
  ACTION_DASH = 0x14,
  ACTION_KNEE_BEND = 0x18,
  GUARD_ON = 0xb2,
  TECH_MISS_UP = 0xb7,
  TECH_MISS_DOWN = 0xbf,
  DASH = 0x14,
  TURN = 0x12,
  LANDING_FALL_SPECIAL = 0x2b,
  JUMP_FORWARD = 0x19,
  JUMP_BACKWARD = 0x1a,
  FALL_FORWARD = 0x1e,
  FALL_BACKWARD = 0x1f,
  GRAB = 0xd4,
  CLIFF_CATCH = 0xfc,
  DAMAGE_FALL = 0x26,

  // Command Grabs
  BARREL_WAIT = 0x125,
  COMMAND_GRAB_RANGE1_START = 0x10a,
  COMMAND_GRAB_RANGE1_END = 0x130,

  COMMAND_GRAB_RANGE2_START = 0x147,
  COMMAND_GRAB_RANGE2_END = 0x152,

  COMMAND_GRAB_RANGE3_START = 0x177,
  COMMAND_GRAB_RANGE3_END = 0x17e,
}

export const Timers = {
  PUNISH_RESET_FRAMES: 45,
  RECOVERY_RESET_FRAMES: 45,
  COMBO_STRING_RESET_FRAMES: 45,
};

export function getSinglesPlayerPermutationsFromSettings(settings: GameStartType): PlayerIndexedType[] {
  if (!settings || settings.players.length !== 2) {
    // Only return opponent indices for singles
    return [];
  }

  return [
    {
      playerIndex: settings.players[0].playerIndex,
      opponentIndex: settings.players[1].playerIndex,
    },
    {
      playerIndex: settings.players[1].playerIndex,
      opponentIndex: settings.players[0].playerIndex,
    },
  ];
}

export function didLoseStock(frame: PostFrameUpdateType, prevFrame: PostFrameUpdateType): boolean {
  if (!frame || !prevFrame) {
    return false;
  }

  return prevFrame.stocksRemaining! - frame.stocksRemaining! > 0;
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
  return (state >= State.DAMAGE_START && state <= State.DAMAGE_END) || state === State.DAMAGE_FALL;
}

export function isGrabbed(state: number): boolean {
  return state >= State.CAPTURE_START && state <= State.CAPTURE_END;
}

// TODO: Find better implementation of 3 seperate ranges
export function isCommandGrabbed(state: number): boolean {
  return (
    ((state >= State.COMMAND_GRAB_RANGE1_START && state <= State.COMMAND_GRAB_RANGE1_END) ||
      (state >= State.COMMAND_GRAB_RANGE2_START && state <= State.COMMAND_GRAB_RANGE2_END) ||
      (state >= State.COMMAND_GRAB_RANGE3_START && state <= State.COMMAND_GRAB_RANGE3_END)) &&
    state !== State.BARREL_WAIT
  );
}

export function isDead(state: number): boolean {
  return state >= State.DYING_START && state <= State.DYING_END;
}

export function calcDamageTaken(frame: PostFrameUpdateType, prevFrame: PostFrameUpdateType): number {
  const percent = frame.percent ?? 0;
  const prevPercent = prevFrame.percent ?? 0;

  return percent - prevPercent;
}
