import { get, forEach } from "lodash";
import fs, { WriteStream } from "fs";
import moment, { Moment } from "moment";
import { Writable, WritableOptions } from "stream";
import { SlpStream, SlpStreamMode, SlpStreamEvent, SlpCommandEventPayload } from "./slpStream";
import { Command, PostFrameUpdateType } from "../types";

const DEFAULT_NICKNAME = "unknown";

export interface SlpFileMetadata {
  startTime: Moment;
  lastFrame: number;
  players: {
    [playerIndex: number]: {
      characterUsage: {
        [internalCharacterId: number]: number;
      };
    };
  };
  consoleNickname?: string;
}

/**
 * SlpFile is a class that wraps a Writable stream. It handles the writing of the binary
 * header and footer, and also handles the overwriting of the raw data length.
 *
 * @class SlpFile
 * @extends {Writable}
 */
export class SlpFile extends Writable {
  private filePath: string;
  private metadata: SlpFileMetadata;
  private fileStream: WriteStream;
  private rawDataLength = 0;
  private slpStream: SlpStream;
  private usesExternalStream = false;

  /**
   * Creates an instance of SlpFile.
   * @param {string} filePath The file location to write to.
   * @param {WritableOptions} [opts] Options for writing.
   * @memberof SlpFile
   */
  public constructor(filePath: string, slpStream?: SlpStream, opts?: WritableOptions) {
    super(opts);
    this.filePath = filePath;
    this.metadata = {
      consoleNickname: DEFAULT_NICKNAME,
      startTime: moment(),
      lastFrame: -124,
      players: {},
    };
    this.usesExternalStream = Boolean(slpStream);

    // Create a new SlpStream if one wasn't already provided
    // This SLP stream represents a single game not multiple, so use manual mode
    this.slpStream = slpStream ? slpStream : new SlpStream({ mode: SlpStreamMode.MANUAL });

    this._setupListeners();
    this._initializeNewGame(this.filePath);
  }

  /**
   * Get the current file path being written to.
   *
   * @returns {string} The location of the current file path
   * @memberof SlpFile
   */
  public path(): string {
    return this.filePath;
  }

  /**
   * Sets the metadata of the Slippi file, such as consoleNickname, lastFrame, and players.
   * @param metadata The metadata to be written
   */
  public setMetadata(metadata: Partial<SlpFileMetadata>): void {
    this.metadata = Object.assign({}, this.metadata, metadata);
  }

  public _write(chunk: Uint8Array, encoding: string, callback: (error?: Error | null) => void): void {
    if (encoding !== "buffer") {
      throw new Error(`Unsupported stream encoding. Expected 'buffer' got '${encoding}'.`);
    }
    // Write it to the file
    this.fileStream.write(chunk);

    // Parse the data manually if it's an internal stream
    if (!this.usesExternalStream) {
      this.slpStream.write(chunk);
    }

    // Keep track of the bytes we've written
    this.rawDataLength += chunk.length;
    callback();
  }

  /**
   * Here we define what to do on each command. We need to populate the metadata field
   * so we keep track of the latest frame, as well as the number of frames each character has
   * been used.
   *
   * @param data The parsed data from a SlpStream
   */
  private _onCommand(data: SlpCommandEventPayload): void {
    const { command, payload } = data;
    switch (command) {
      case Command.POST_FRAME_UPDATE:
        // Here we need to update some metadata fields
        const { frame, playerIndex, isFollower, internalCharacterId } = payload as PostFrameUpdateType;
        if (isFollower) {
          // No need to do this for follower
          break;
        }

        // Update frame index
        this.metadata.lastFrame = frame;

        // Update character usage
        const characterUsage: {
          [internalCharacterId: number]: number;
        } = get(this.metadata, ["players", playerIndex, "characterUsage"]);
        const curCharFrames = get(characterUsage, internalCharacterId, 0);
        const player = {
          characterUsage: {
            ...characterUsage,
            [internalCharacterId]: curCharFrames + 1,
          },
        };
        this.metadata.players[playerIndex] = player;
        break;
    }
  }

  private _setupListeners(): void {
    const streamListener = (data: SlpCommandEventPayload): void => {
      this._onCommand(data);
    };
    this.slpStream.on(SlpStreamEvent.COMMAND, streamListener);

    this.on("finish", () => {
      // Update file with bytes written
      const fd = fs.openSync(this.filePath, "r+");
      fs.writeSync(fd, createUInt32Buffer(this.rawDataLength), 0, 4, 11);
      fs.closeSync(fd);

      // Unsubscribe from the stream
      this.slpStream.removeListener(SlpStreamEvent.COMMAND, streamListener);
      // Terminate the internal stream
      if (!this.usesExternalStream) {
        this.slpStream.end();
      }
    });
  }

  private _initializeNewGame(filePath: string): void {
    this.fileStream = fs.createWriteStream(filePath, {
      encoding: "binary",
    });

    const header = Buffer.concat([
      Buffer.from("{U"),
      Buffer.from([3]),
      Buffer.from("raw[$U#l"),
      Buffer.from([0, 0, 0, 0]),
    ]);
    this.fileStream.write(header);
  }

  public _final(callback: (error?: Error | null) => void): void {
    let footer = Buffer.concat([Buffer.from("U"), Buffer.from([8]), Buffer.from("metadata{")]);

    // Write game start time
    const startTimeStr = this.metadata.startTime.toISOString();
    footer = Buffer.concat([
      footer,
      Buffer.from("U"),
      Buffer.from([7]),
      Buffer.from("startAtSU"),
      Buffer.from([startTimeStr.length]),
      Buffer.from(startTimeStr),
    ]);

    // Write last frame index
    // TODO: Get last frame
    const lastFrame = this.metadata.lastFrame;
    footer = Buffer.concat([
      footer,
      Buffer.from("U"),
      Buffer.from([9]),
      Buffer.from("lastFramel"),
      createInt32Buffer(lastFrame),
    ]);

    // write the Console Nickname
    const consoleNick = this.metadata.consoleNickname || DEFAULT_NICKNAME;
    footer = Buffer.concat([
      footer,
      Buffer.from("U"),
      Buffer.from([11]),
      Buffer.from("consoleNickSU"),
      Buffer.from([consoleNick.length]),
      Buffer.from(consoleNick),
    ]);

    // Start writting player specific data
    footer = Buffer.concat([footer, Buffer.from("U"), Buffer.from([7]), Buffer.from("players{")]);
    const players = this.metadata.players;
    forEach(players, (player, index) => {
      // Start player obj with index being the player index
      footer = Buffer.concat([footer, Buffer.from("U"), Buffer.from([index.length]), Buffer.from(`${index}{`)]);

      // Start characters key for this player
      footer = Buffer.concat([footer, Buffer.from("U"), Buffer.from([10]), Buffer.from("characters{")]);

      // Write character usage
      forEach(player.characterUsage, (usage, internalId) => {
        // Write this character
        footer = Buffer.concat([
          footer,
          Buffer.from("U"),
          Buffer.from([internalId.length]),
          Buffer.from(`${internalId}l`),
          createUInt32Buffer(usage),
        ]);
      });

      // Close characters and player
      footer = Buffer.concat([footer, Buffer.from("}}")]);
    });

    // Close players
    footer = Buffer.concat([footer, Buffer.from("}")]);

    // Write played on
    footer = Buffer.concat([
      footer,
      Buffer.from("U"),
      Buffer.from([8]),
      Buffer.from("playedOnSU"),
      Buffer.from([7]),
      Buffer.from("network"),
    ]);

    // Close metadata and file
    footer = Buffer.concat([footer, Buffer.from("}}")]);

    // End the stream
    this.fileStream.write(footer, callback);
  }
}

const createInt32Buffer = (number: number): Buffer => {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(number, 0);
  return buf;
};

const createUInt32Buffer = (number: number): Buffer => {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(number, 0);
  return buf;
};
