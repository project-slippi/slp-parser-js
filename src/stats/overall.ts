import _ from "lodash";
import { ConversionType, PlayerIndexedType, StockType, OverallType, RatioType, InputCountsType, AnalogMotionType } from "./common";
import { PlayerInput } from "./inputs";

interface ConversionsByPlayerByOpening {
  [playerIndex: string]: {
    [openingType: string]: ConversionType[];
  };
}

export function generateOverallStats(
  playerIndices: PlayerIndexedType[],
  inputs: PlayerInput[],
  stocks: StockType[],
  conversions: ConversionType[],
  playableFrameCount: number,
): OverallType[] {
  const inputsByPlayer = _.keyBy(inputs, "playerIndex");
  const stocksByPlayer = _.groupBy(stocks, "playerIndex");
  const conversionsByPlayer = _.groupBy(conversions, "playerIndex");
  const conversionsByPlayerByOpening: ConversionsByPlayerByOpening = _.mapValues(conversionsByPlayer, (conversions) =>
    _.groupBy(conversions, "openingType"),
  );

  const gameMinutes = playableFrameCount / 3600;

  const overall = playerIndices.map((indices) => {
    const playerIndex = indices.playerIndex;
    const opponentIndex = indices.opponentIndex;
    const playerInputs = _.get(inputsByPlayer, playerIndex) || {};
    const inputCounts: InputCountsType = {
      buttons: _.get(playerInputs, "buttonInputCount"),
      triggers: _.get(playerInputs, "triggerInputCount"),
      cstick: _.get(playerInputs, "cstickInputCount"),
      joystick: _.get(playerInputs, "joystickInputCount"),
      total: _.get(playerInputs, "inputCount"),
    };
    const conversions = _.get(conversionsByPlayer, playerIndex) || [];
    const successfulConversions = conversions.filter((conversion) => conversion.moves.length > 1);
    const opponentStocks = _.get(stocksByPlayer, opponentIndex) || [];
    const opponentEndedStocks = _.filter(opponentStocks, "endFrame");

    const conversionCount = conversions.length;
    const successfulConversionCount = successfulConversions.length;
    const totalDamage =
      _.sumBy(conversions, (conversion) => conversion.moves.reduce((total, move) => total + move.damage, 0)) || 0;
    const killCount = opponentEndedStocks.length;

    const joystickAnalogDistance = _.get(playerInputs, "joystickDistanceTraveled");
    const joystickMotionFrameCount = _.get(playerInputs, "joystickMotionFrameCount");
    // Distance from stick top to gyro center is ~2cm. Distance from center to edge of gate is ~.47 rad.
    // If there are more detailed measurements that have been taken, this is the place to use them.
    const joystickMetersTraveled = joystickAnalogDistance * (.02 * .47);
    const joystickMotion: AnalogMotionType = {
      distanceTraveled: joystickAnalogDistance,
      metersTraveled: joystickMetersTraveled,
      analogMotionFrameCount: joystickMotionFrameCount,
      averageVelocity: getRatio(joystickMetersTraveled, joystickMotionFrameCount / 60),
    }

    return {
      playerIndex: playerIndex,
      opponentIndex: opponentIndex,
      inputCounts: inputCounts,
      conversionCount: conversionCount,
      totalDamage: totalDamage,
      killCount: killCount,

      successfulConversions: getRatio(successfulConversionCount, conversionCount),
      inputsPerMinute: getRatio(inputCounts.total, gameMinutes),
      digitalInputsPerMinute: getRatio(inputCounts.buttons, gameMinutes),
      joystickMotion: joystickMotion,
      openingsPerKill: getRatio(conversionCount, killCount),
      damagePerOpening: getRatio(totalDamage, conversionCount),
      neutralWinRatio: getOpeningRatio(conversionsByPlayerByOpening, playerIndex, opponentIndex, "neutral-win"),
      counterHitRatio: getOpeningRatio(conversionsByPlayerByOpening, playerIndex, opponentIndex, "counter-attack"),
      beneficialTradeRatio: getBeneficialTradeRatio(conversionsByPlayerByOpening, playerIndex, opponentIndex),
    };
  });

  return overall;
}

function getRatio(count: number, total: number): RatioType {
  return {
    count: count,
    total: total,
    ratio: total ? count / total : null,
  };
}

function getOpeningRatio(
  conversionsByPlayerByOpening: ConversionsByPlayerByOpening,
  playerIndex: number,
  opponentIndex: number,
  type: string,
): RatioType {
  const openings = _.get(conversionsByPlayerByOpening, [playerIndex, type]) || [];

  const opponentOpenings = _.get(conversionsByPlayerByOpening, [opponentIndex, type]) || [];

  return getRatio(openings.length, openings.length + opponentOpenings.length);
}

function getBeneficialTradeRatio(
  conversionsByPlayerByOpening: ConversionsByPlayerByOpening,
  playerIndex: number,
  opponentIndex: number,
): RatioType {
  const playerTrades = _.get(conversionsByPlayerByOpening, [playerIndex, "trade"]) || [];
  const opponentTrades = _.get(conversionsByPlayerByOpening, [opponentIndex, "trade"]) || [];

  const benefitsPlayer = [];

  // Figure out which punishes benefited this player
  const zippedTrades = _.zip(playerTrades, opponentTrades);
  zippedTrades.forEach((conversionPair) => {
    const playerConversion = _.first(conversionPair);
    const opponentConversion = _.last(conversionPair);
    const playerDamage = playerConversion!.currentPercent - playerConversion!.startPercent;
    const opponentDamage = opponentConversion!.currentPercent - opponentConversion!.startPercent;

    if (playerConversion!.didKill && !opponentConversion!.didKill) {
      benefitsPlayer.push(playerConversion);
    } else if (playerDamage > opponentDamage) {
      benefitsPlayer.push(playerConversion);
    }
  });

  return getRatio(benefitsPlayer.length, playerTrades.length);
}
