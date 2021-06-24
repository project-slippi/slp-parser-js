import _ from "lodash";

import {
  ActionsComputer,
  ComboComputer,
  ConversionComputer,
  generateOverallStats,
  InputComputer,
  StatOptions,
  Stats,
  StatsType,
  StockComputer,
} from "./stats";
// Type imports
import { FrameEntryType, FramesType, GameEndType, GameStartType, MetadataType } from "./types";
import { SlpParser, SlpParserEvent } from "./utils/slpParser";
import { closeSlpFile, getMetadata, iterateEvents, openSlpFile, SlpInputSource, SlpReadInput } from "./utils/slpReader";

/**
 * Slippi Game class that wraps a file
 */
export class SlippiGame {
  private input: SlpReadInput;
  private metadata: MetadataType | null = null;
  private finalStats: StatsType | null = null;
  private parser: SlpParser;
  private readPosition: number | null = null;
  private actionsComputer: ActionsComputer = new ActionsComputer();
  private conversionComputer: ConversionComputer = new ConversionComputer();
  private comboComputer: ComboComputer = new ComboComputer();
  private stockComputer: StockComputer = new StockComputer();
  private inputComputer: InputComputer = new InputComputer();
  private statsComputer: Stats;

  public constructor(input: string | Buffer | ArrayBuffer, opts?: StatOptions) {
    if (_.isString(input)) {
      this.input = {
        source: SlpInputSource.FILE,
        filePath: input as string,
      };
    } else if (input instanceof Buffer) {
      this.input = {
        source: SlpInputSource.BUFFER,
        buffer: input,
      };
    } else if (input instanceof ArrayBuffer) {
      this.input = {
        source: SlpInputSource.BUFFER,
        buffer: Buffer.from(input),
      };
    } else {
      throw new Error("Cannot create SlippiGame with input of that type");
    }

    // Set up stats calculation
    this.statsComputer = new Stats(opts);
    this.statsComputer.register(
      this.actionsComputer,
      this.comboComputer,
      this.conversionComputer,
      this.inputComputer,
      this.stockComputer,
    );
    this.parser = new SlpParser();
    this.parser.on(SlpParserEvent.SETTINGS, (settings) => {
      this.statsComputer.setup(settings);
    });
    // Use finalized frames for stats computation
    this.parser.on(SlpParserEvent.FINALIZED_FRAME, (frame: FrameEntryType) => {
      this.statsComputer.addFrame(frame);
    });
  }

  private _process(settingsOnly = false): void {
    if (this.parser.getGameEnd() !== null) {
      return;
    }
    const slpfile = openSlpFile(this.input);
    // Generate settings from iterating through file
    this.readPosition = iterateEvents(
      slpfile,
      (command, payload) => {
        if (!payload) {
          // If payload is falsy, keep iterating. The parser probably just doesn't know
          // about this command yet
          return false;
        }
        this.parser.handleCommand(command, payload);
        return settingsOnly && this.parser.getSettings() !== null;
      },
      this.readPosition,
    );
    closeSlpFile(slpfile);
  }

  /**
   * Gets the game settings, these are the settings that describe the starting state of
   * the game such as characters, stage, etc.
   */
  public getSettings(): GameStartType | null {
    // Settings is only complete after post-frame update
    this._process(true);
    return this.parser.getSettings();
  }

  public getLatestFrame(): FrameEntryType | null {
    this._process();
    return this.parser.getLatestFrame();
  }

  public getGameEnd(): GameEndType | null {
    this._process();
    return this.parser.getGameEnd();
  }

  public getFrames(): FramesType {
    this._process();
    return this.parser.getFrames();
  }

  public getStats(): StatsType | null {
    if (this.finalStats) {
      return this.finalStats;
    }

    this._process();

    const settings = this.parser.getSettings();
    if (settings === null) {
      return null;
    }

    // Finish processing if we're not up to date
    this.statsComputer.process();
    const inputs = this.inputComputer.fetch();
    const stocks = this.stockComputer.fetch();
    const conversions = this.conversionComputer.fetch();
    const playableFrames = this.parser.getPlayableFrameCount();
    const overall = generateOverallStats(settings, inputs, stocks, conversions, playableFrames);

    const stats = {
      lastFrame: this.parser.getLatestFrameNumber(),
      playableFrameCount: playableFrames,
      stocks: stocks,
      conversions: conversions,
      combos: this.comboComputer.fetch(),
      actionCounts: this.actionsComputer.fetch(),
      overall: overall,
      gameComplete: this.parser.getGameEnd() !== null,
    };

    if (this.parser.getGameEnd() !== null) {
      // If the game is complete, store a cached version of stats because it should not
      // change anymore. Ideally the statsCompuer.process and fetch functions would simply do no
      // work in this case instead but currently the conversions fetch function,
      // generateOverallStats, and maybe more are doing work on every call.
      this.finalStats = stats;
    }

    return stats;
  }

  public getMetadata(): MetadataType | null {
    if (this.metadata) {
      return this.metadata;
    }
    const slpfile = openSlpFile(this.input);
    this.metadata = getMetadata(slpfile);
    closeSlpFile(slpfile);
    return this.metadata;
  }

  public getFilePath(): string | null {
    if (this.input.source !== SlpInputSource.FILE) {
      return null;
    }

    return this.input.filePath ?? null;
  }
}
