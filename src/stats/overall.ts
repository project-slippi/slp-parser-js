import _ from 'lodash';
import { ConversionType, PlayerIndexedType, StockType, OverallType, RatioType } from "./common";
import { PlayerInput } from './inputs';

type ConversionsByPlayerByOpening = {
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
  const inputsByPlayer = _.keyBy(inputs, 'playerIndex');
  const stocksByPlayer = _.groupBy(stocks, 'playerIndex');
  const conversionsByPlayer = _.groupBy(conversions, 'playerIndex');
  const conversionsByPlayerByOpening: ConversionsByPlayerByOpening = _.mapValues(conversionsByPlayer, (conversions) => (
    _.groupBy(conversions, 'openingType')
  ));

  const gameMinutes = playableFrameCount / 3600;

  const overall = playerIndices.map(indices => {
    const playerIndex = indices.playerIndex;
    const opponentIndex = indices.opponentIndex;

    const inputCount = _.get(inputsByPlayer, [playerIndex, 'inputCount']) || 0;
    const conversions = _.get(conversionsByPlayer, playerIndex) || [];
    const successfulConversions = conversions.filter(conversion => conversion.moves.length > 1);
    const opponentStocks = _.get(stocksByPlayer, opponentIndex) || [];
    const playerStocks = _.get(stocksByPlayer, playerIndex) || [];
    const opponentEndedStocks = _.filter(opponentStocks, 'endFrame');

    const conversionCount = conversions.length;
    const successfulConversionCount = successfulConversions.length;
    const totalDamage = _.sumBy(opponentStocks, 'currentPercent') || 0;
    const killCount = opponentEndedStocks.length;

    return {
      playerIndex: playerIndex,
      opponentIndex: opponentIndex,

      inputCount: inputCount,
      conversionCount: conversionCount,
      totalDamage: totalDamage,
      killCount: killCount,

      successfulConversions: getRatio(successfulConversionCount, conversionCount),
      inputsPerMinute: getRatio(inputCount, gameMinutes),
      openingsPerKill: getRatio(conversionCount, killCount),
      damagePerOpening: getRatio(totalDamage, conversionCount),
      neutralWinRatio: getOpeningRatio(
        conversionsByPlayerByOpening, playerIndex, opponentIndex, 'neutral-win'
      ),
      counterHitRatio: getOpeningRatio(
        conversionsByPlayerByOpening, playerIndex, opponentIndex, 'counter-attack'
      ),
      beneficialTradeRatio: getBeneficialTradeRatio(
        conversionsByPlayerByOpening, playerIndex, opponentIndex
      ),
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

function getOpeningRatio(conversionsByPlayerByOpening: ConversionsByPlayerByOpening, playerIndex: number, opponentIndex: number, type: string): RatioType {
  const openings = _.get(
    conversionsByPlayerByOpening, [playerIndex, type]
  ) || [];

  const opponentOpenings = _.get(
    conversionsByPlayerByOpening, [opponentIndex, type]
  ) || [];

  return getRatio(openings.length, openings.length + opponentOpenings.length);
}

function getBeneficialTradeRatio(conversionsByPlayerByOpening: ConversionsByPlayerByOpening, playerIndex: number, opponentIndex: number): RatioType {
  const playerTrades = _.get(
    conversionsByPlayerByOpening, [playerIndex, 'trade']
  ) || [];
  const opponentTrades = _.get(
    conversionsByPlayerByOpening, [opponentIndex, 'trade']
  ) || [];

  const benefitsPlayer = [];

  // Figure out which punishes benefited this player
  const zippedTrades: [ConversionType, ConversionType][] = _.zip(playerTrades, opponentTrades);
  zippedTrades.forEach((conversionPair) => {
    const playerConversion = _.first(conversionPair);
    const opponentConversion = _.last(conversionPair);
    const playerDamage = playerConversion.currentPercent - playerConversion.startPercent;
    const opponentDamage = opponentConversion.currentPercent - opponentConversion.startPercent;

    if (playerConversion.didKill && !opponentConversion.didKill) {
      benefitsPlayer.push(playerConversion);
    } else if (playerDamage > opponentDamage) {
      benefitsPlayer.push(playerConversion);
    }
  });

  return getRatio(benefitsPlayer.length, playerTrades.length);
}
