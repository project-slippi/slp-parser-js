import fs from "fs";
import { Writable } from "stream";

import SlippiGame, {
  Command,
  SlpStreamMode,
  SlpStream,
  Frames,
  SlpCommandEventPayload,
  SlpStreamEvent,
  FrameBookendType,
  SlpParser,
  SlpParserEvent,
  FrameEntryType,
  MAX_ROLLBACK_FRAMES,
  GameMode,
} from "../src";

describe("when reading last finalised frame from SlpStream", () => {
  it("should never decrease", async () => {
    const testFile = "slp/finalizedFrame.slp";
    const stream = new SlpStream({
      mode: SlpStreamMode.MANUAL,
    });
    const parser = new SlpParser();

    let lastFinalizedFrame = Frames.FIRST - 1;
    let parserLastFinalizedFrame = Frames.FIRST - 1;

    // The game mode should be online
    const game = new SlippiGame(testFile);
    const settings = game.getSettings();
    expect(settings.gameMode).toEqual(GameMode.ONLINE);

    stream.on(SlpStreamEvent.COMMAND, (data: SlpCommandEventPayload) => {
      parser.handleCommand(data.command, data.payload);
      switch (data.command) {
        case Command.FRAME_BOOKEND:
          const payload = data.payload as FrameBookendType;
          expect(payload).toBeTruthy();
          // We should never have the latest finalized frame be less than the first frame
          expect(payload.latestFinalizedFrame).not.toEqual(Frames.FIRST - 1);
          expect(payload.latestFinalizedFrame).toBeGreaterThanOrEqual(lastFinalizedFrame);
          // We also expect it to be within 7 frames of the current frame
          expect(payload.latestFinalizedFrame).toBeGreaterThanOrEqual(payload.frame - MAX_ROLLBACK_FRAMES);
          lastFinalizedFrame = payload.latestFinalizedFrame;
      }
    });

    parser.on(SlpParserEvent.FINALIZED_FRAME, (frameEntry: FrameEntryType) => {
      expect(frameEntry).toBeTruthy();
      const { frame } = frameEntry;
      // We should never receive the same frame twice
      expect(frame).not.toEqual(parserLastFinalizedFrame);
      // The frame should monotonically increase
      expect(frame).toEqual(parserLastFinalizedFrame + 1);
      parserLastFinalizedFrame = frame;
    });

    await pipeFileContents(testFile, stream);

    // The last finalized frame should be the same as what's recorded in the metadata
    const metadata = game.getMetadata();
    expect(metadata.lastFrame).toEqual(lastFinalizedFrame);
  });
});

describe("when reading finalised frames from SlpParser", () => {
  it("should support older SLP files without frame bookend", async () => {
    const testFile = "slp/sheik_vs_ics_yoshis.slp";
    const stream = new SlpStream({
      mode: SlpStreamMode.MANUAL,
    });
    const parser = new SlpParser();

    let lastFinalizedFrame = Frames.FIRST - 1;

    // Check the finalized frames to ensure they're increasing
    parser.on(SlpParserEvent.FINALIZED_FRAME, (frameEntry: FrameEntryType) => {
      expect(frameEntry).toBeTruthy();
      const { frame } = frameEntry;
      // We should never receive the same frame twice
      expect(frame).not.toEqual(lastFinalizedFrame);
      // The frame should monotonically increase
      expect(frame).toEqual(lastFinalizedFrame + 1);
      lastFinalizedFrame = frame;
    });

    // Forward all the commands to the parser
    stream.on(SlpStreamEvent.COMMAND, (data: SlpCommandEventPayload) => {
      parser.handleCommand(data.command, data.payload);
    });

    await pipeFileContents(testFile, stream);

    // The last finalized frame should be the same as what's recorded in the metadata
    const game = new SlippiGame(testFile);
    const metadata = game.getMetadata();
    expect(metadata).toBeDefined();
    const lastFrame = metadata.lastFrame || game.getLatestFrame().frame;
    expect(lastFrame).toEqual(lastFinalizedFrame);
  });

  it("should only increase", async () => {
    const testFile = "slp/finalizedFrame.slp";
    const stream = new SlpStream({
      mode: SlpStreamMode.MANUAL,
    });
    const parser = new SlpParser();

    let lastFinalizedFrame = Frames.FIRST - 1;

    // Check the finalized frames to ensure they're increasing
    parser.on(SlpParserEvent.FINALIZED_FRAME, (frameEntry: FrameEntryType) => {
      const { frame } = frameEntry;
      // We should never receive the same frame twice
      expect(frame).not.toEqual(lastFinalizedFrame);
      // The frame should monotonically increase
      expect(frame).toEqual(lastFinalizedFrame + 1);
      lastFinalizedFrame = frame;
    });

    // Forward all the commands to the parser
    stream.on(SlpStreamEvent.COMMAND, (data: SlpCommandEventPayload) => {
      parser.handleCommand(data.command, data.payload);
    });

    await pipeFileContents(testFile, stream);

    // The last finalized frame should be the same as what's recorded in the metadata
    const game = new SlippiGame(testFile);
    const metadata = game.getMetadata();
    expect(metadata.lastFrame).toEqual(lastFinalizedFrame);
  });
});

const pipeFileContents = async (filename: string, destination: Writable): Promise<void> => {
  return new Promise((resolve): void => {
    const readStream = fs.createReadStream(filename);
    readStream.on("open", () => {
      readStream.pipe(destination);
    });
    readStream.on("close", () => {
      resolve();
    });
  });
};
