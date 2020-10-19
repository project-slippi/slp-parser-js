import _ from "lodash";
import fs from "fs";
import iconv from "iconv-lite";
import { decode } from "@shelacek/ubjson";

import { toHalfwidth } from "./fullwidth";
import { Command, EventCallbackFunc, EventPayloadTypes, MetadataType, PlayerType } from "../types";

export enum SlpInputSource {
  BUFFER = "buffer",
  FILE = "file",
}

export interface SlpReadInput {
  source: SlpInputSource;
  filePath?: string;
  buffer?: Buffer;
}

export type SlpRefType = SlpFileSourceRef | SlpBufferSourceRef;

export interface SlpFileType {
  ref: SlpRefType;
  rawDataPosition: number;
  rawDataLength: number;
  metadataPosition: number;
  metadataLength: number;
  messageSizes: {
    [command: number]: number;
  };
}

export interface SlpFileSourceRef {
  source: SlpInputSource;
  fileDescriptor: number;
}

export interface SlpBufferSourceRef {
  source: SlpInputSource;
  buffer: Buffer;
}

async function getRef(input: SlpReadInput): Promise<SlpRefType> {
  switch (input.source) {
    case SlpInputSource.FILE:
      return new Promise(
        (resolve: (value: SlpRefType) => void, reject: (reason: NodeJS.ErrnoException) => void): void => {
          fs.open(input.filePath, "r", (err, fd) => {
            if (!!err) {
              reject(err);
            } else {
              const ref = {
                source: input.source,
                fileDescriptor: fd,
              } as SlpFileSourceRef;
              resolve(ref);
            }
          });
        },
      );
    case SlpInputSource.BUFFER:
      return {
        source: input.source,
        buffer: input.buffer,
      } as SlpBufferSourceRef;
    default:
      throw new Error("Source type not supported");
  }
}

async function readRef(
  ref: SlpRefType,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: number,
): Promise<number> {
  switch (ref.source) {
    case SlpInputSource.FILE:
      return new Promise((resolve: (value: number) => void, reject: (reason: NodeJS.ErrnoException) => void): void => {
        fs.read(
          (ref as SlpFileSourceRef).fileDescriptor,
          buffer,
          offset,
          length,
          position,
          (err: NodeJS.ErrnoException, bytesRead: number) => {
            if (!!err) {
              reject(err);
            } else {
              resolve(bytesRead);
            }
          },
        );
      });
    case SlpInputSource.BUFFER:
      return (ref as SlpBufferSourceRef).buffer.copy(buffer, offset, position, position + length);
    default:
      throw new Error("Source type not supported");
  }
}

async function getLenRef(ref: SlpRefType): Promise<number> {
  switch (ref.source) {
    case SlpInputSource.FILE:
      return new Promise((resolve: (value: number) => void, reject: (reason: NodeJS.ErrnoException) => void): void => {
        return fs.fstat((ref as SlpFileSourceRef).fileDescriptor, (err, fileStats) => {
          if (!!err) {
            reject(err);
          } else {
            resolve(fileStats.size);
          }
        });
      });
    case SlpInputSource.BUFFER:
      return (ref as SlpBufferSourceRef).buffer.length;
    default:
      throw new Error("Source type not supported");
  }
}

/**
 * Opens a file at path
 */
export async function openSlpFile(input: SlpReadInput): Promise<SlpFileType> {
  const ref = await getRef(input);

  const rawDataPosition = await getRawDataPosition(ref);
  const rawDataLength = await getRawDataLength(ref, rawDataPosition);
  const metadataPosition = rawDataPosition + rawDataLength + 10; // remove metadata string
  const metadataLength = await getMetadataLength(ref, metadataPosition);
  const messageSizes = await getMessageSizes(ref, rawDataPosition);

  return {
    ref: ref,
    rawDataPosition: rawDataPosition,
    rawDataLength: rawDataLength,
    metadataPosition: metadataPosition,
    metadataLength: metadataLength,
    messageSizes: messageSizes,
  };
}

export async function closeSlpFile(file: SlpFileType): Promise<void> {
  switch (file.ref.source) {
    case SlpInputSource.FILE:
      return new Promise((resolve: (value: void) => void, reject: (reason: NodeJS.ErrnoException) => void): void => {
        fs.close((file.ref as SlpFileSourceRef).fileDescriptor, (err) => {
          if (!!err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      break;
  }
}

// This function gets the position where the raw data starts
async function getRawDataPosition(ref: SlpRefType): Promise<number> {
  const buffer = new Uint8Array(1);
  await readRef(ref, buffer, 0, buffer.length, 0);

  if (buffer[0] === 0x36) {
    return 0;
  }

  if (buffer[0] !== "{".charCodeAt(0)) {
    return 0; // return error?
  }

  return 15;
}

async function getRawDataLength(ref: SlpRefType, position: number): Promise<number> {
  const fileSize = await getLenRef(ref);
  if (position === 0) {
    return fileSize;
  }

  const buffer = new Uint8Array(4);
  await readRef(ref, buffer, 0, buffer.length, position - 4);

  const rawDataLen = (buffer[0] << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
  if (rawDataLen > 0) {
    // If this method manages to read a number, it's probably trustworthy
    return rawDataLen;
  }

  // If the above does not return a valid data length,
  // return a file size based on file length. This enables
  // some support for severed files
  return fileSize - position;
}

async function getMetadataLength(ref: SlpRefType, position: number): Promise<number> {
  const len = await getLenRef(ref);
  return len - position - 1;
}

async function getMessageSizes(
  ref: SlpRefType,
  position: number,
): Promise<{
  [command: number]: number;
}> {
  const messageSizes: {
    [command: number]: number;
  } = {};
  // Support old file format
  if (position === 0) {
    messageSizes[0x36] = 0x140;
    messageSizes[0x37] = 0x6;
    messageSizes[0x38] = 0x46;
    messageSizes[0x39] = 0x1;
    return messageSizes;
  }

  const buffer = new Uint8Array(2);
  await readRef(ref, buffer, 0, buffer.length, position);
  if (buffer[0] !== Command.MESSAGE_SIZES) {
    return {};
  }

  const payloadLength = buffer[1];
  messageSizes[0x35] = payloadLength;

  const messageSizesBuffer = new Uint8Array(payloadLength - 1);
  await readRef(ref, messageSizesBuffer, 0, messageSizesBuffer.length, position + 2);
  for (let i = 0; i < payloadLength - 1; i += 3) {
    const command = messageSizesBuffer[i];

    // Get size of command
    messageSizes[command] = (messageSizesBuffer[i + 1] << 8) | messageSizesBuffer[i + 2];
  }

  return messageSizes;
}

/**
 * Iterates through slp events and parses payloads
 */
export async function iterateEvents(
  slpFile: SlpFileType,
  callback: EventCallbackFunc,
  startPos: number | null = null,
): Promise<number> {
  const ref = slpFile.ref;

  let readPosition = startPos || slpFile.rawDataPosition;
  const stopReadingAt = slpFile.rawDataPosition + slpFile.rawDataLength;

  // Generate read buffers for each
  const commandPayloadBuffers = _.mapValues(slpFile.messageSizes, (size) => new Uint8Array(size + 1));

  const commandByteBuffer = new Uint8Array(1);
  while (readPosition < stopReadingAt) {
    await readRef(ref, commandByteBuffer, 0, 1, readPosition);
    const commandByte = commandByteBuffer[0];
    const buffer = commandPayloadBuffers[commandByte];
    if (buffer === undefined) {
      // If we don't have an entry for this command, return false to indicate failed read
      return readPosition;
    }

    if (buffer.length > stopReadingAt - readPosition) {
      return readPosition;
    }

    await readRef(ref, buffer, 0, buffer.length, readPosition);
    const parsedPayload = parseMessage(commandByte, buffer);
    const shouldStop = callback(commandByte, parsedPayload);
    if (shouldStop) {
      break;
    }

    readPosition += buffer.length;
  }

  return readPosition;
}

export function parseMessage(command: Command, payload: Uint8Array): EventPayloadTypes | null {
  const view = new DataView(payload.buffer);
  switch (command) {
    case Command.GAME_START:
      const getPlayerObject = (playerIndex: number): PlayerType => {
        // Controller Fix stuff
        const cfOffset = playerIndex * 0x8;
        const dashback = readUint32(view, 0x141 + cfOffset);
        const shieldDrop = readUint32(view, 0x145 + cfOffset);
        let cfOption = "None";
        if (dashback !== shieldDrop) {
          cfOption = "Mixed";
        } else if (dashback === 1) {
          cfOption = "UCF";
        } else if (dashback === 2) {
          cfOption = "Dween";
        }

        // Nametag stuff
        const nametagOffset = playerIndex * 0x10;
        const nametagStart = 0x161 + nametagOffset;
        const nametagBuf = payload.slice(nametagStart, nametagStart + 16);
        const nametag = toHalfwidth(
          iconv
            .decode(nametagBuf as Buffer, "Shift_JIS")
            .split("\0")
            .shift(),
        );

        const offset = playerIndex * 0x24;
        return {
          playerIndex: playerIndex,
          port: playerIndex + 1,
          characterId: readUint8(view, 0x65 + offset),
          characterColor: readUint8(view, 0x68 + offset),
          startStocks: readUint8(view, 0x67 + offset),
          type: readUint8(view, 0x66 + offset),
          teamId: readUint8(view, 0x6e + offset),
          controllerFix: cfOption,
          nametag: nametag,
        };
      };
      return {
        slpVersion: `${readUint8(view, 0x1)}.${readUint8(view, 0x2)}.${readUint8(view, 0x3)}`,
        isTeams: readBool(view, 0xd),
        isPAL: readBool(view, 0x1a1),
        stageId: readUint16(view, 0x13),
        players: [0, 1, 2, 3].map(getPlayerObject),
        scene: readUint8(view, 0x1a3),
        gameMode: readUint8(view, 0x1a4),
      };
    case Command.PRE_FRAME_UPDATE:
      return {
        frame: readInt32(view, 0x1),
        playerIndex: readUint8(view, 0x5),
        isFollower: readBool(view, 0x6),
        seed: readUint32(view, 0x7),
        actionStateId: readUint16(view, 0xb),
        positionX: readFloat(view, 0xd),
        positionY: readFloat(view, 0x11),
        facingDirection: readFloat(view, 0x15),
        joystickX: readFloat(view, 0x19),
        joystickY: readFloat(view, 0x1d),
        cStickX: readFloat(view, 0x21),
        cStickY: readFloat(view, 0x25),
        trigger: readFloat(view, 0x29),
        buttons: readUint32(view, 0x2d),
        physicalButtons: readUint16(view, 0x31),
        physicalLTrigger: readFloat(view, 0x33),
        physicalRTrigger: readFloat(view, 0x37),
        percent: readFloat(view, 0x3c),
      };
    case Command.POST_FRAME_UPDATE:
      return {
        frame: readInt32(view, 0x1),
        playerIndex: readUint8(view, 0x5),
        isFollower: readBool(view, 0x6),
        internalCharacterId: readUint8(view, 0x7),
        actionStateId: readUint16(view, 0x8),
        positionX: readFloat(view, 0xa),
        positionY: readFloat(view, 0xe),
        facingDirection: readFloat(view, 0x12),
        percent: readFloat(view, 0x16),
        shieldSize: readFloat(view, 0x1a),
        lastAttackLanded: readUint8(view, 0x1e),
        currentComboCount: readUint8(view, 0x1f),
        lastHitBy: readUint8(view, 0x20),
        stocksRemaining: readUint8(view, 0x21),
        actionStateCounter: readFloat(view, 0x22),
        lCancelStatus: readUint8(view, 0x33),
      };
    case Command.ITEM_UPDATE:
      return {
        frame: readInt32(view, 0x1),
        typeId: readUint16(view, 0x5),
        state: readUint8(view, 0x7),
        facingDirection: readFloat(view, 0x8),
        velocityX: readFloat(view, 0xc),
        velocityY: readFloat(view, 0x10),
        positionX: readFloat(view, 0x14),
        positionY: readFloat(view, 0x18),
        damageTaken: readUint16(view, 0x1c),
        expirationTimer: readUint16(view, 0x1e),
        spawnId: readUint32(view, 0x20),
      };
    case Command.FRAME_BOOKEND:
      return {
        frame: readInt32(view, 0x1),
        latestFinalizedFrame: readInt32(view, 0x5),
      };
    case Command.GAME_END:
      return {
        gameEndMethod: readUint8(view, 0x1),
        lrasInitiatorIndex: readInt8(view, 0x2),
      };
    default:
      return null;
  }
}

function canReadFromView(view: DataView, offset: number, length: number): boolean {
  const viewLength = view.byteLength;
  return offset + length <= viewLength;
}

function readFloat(view: DataView, offset: number): number | null {
  if (!canReadFromView(view, offset, 4)) {
    return null;
  }

  return view.getFloat32(offset);
}

function readInt32(view: DataView, offset: number): number | null {
  if (!canReadFromView(view, offset, 4)) {
    return null;
  }

  return view.getInt32(offset);
}

function readInt8(view: DataView, offset: number): number | null {
  if (!canReadFromView(view, offset, 1)) {
    return null;
  }

  return view.getInt8(offset);
}

function readUint32(view: DataView, offset: number): number | null {
  if (!canReadFromView(view, offset, 4)) {
    return null;
  }

  return view.getUint32(offset);
}

function readUint16(view: DataView, offset: number): number | null {
  if (!canReadFromView(view, offset, 2)) {
    return null;
  }

  return view.getUint16(offset);
}

function readUint8(view: DataView, offset: number): number | null {
  if (!canReadFromView(view, offset, 1)) {
    return null;
  }

  return view.getUint8(offset);
}

function readBool(view: DataView, offset: number): boolean | null {
  if (!canReadFromView(view, offset, 1)) {
    return null;
  }

  return !!view.getUint8(offset);
}

export async function getMetadata(slpFile: SlpFileType): Promise<MetadataType | null> {
  if (slpFile.metadataLength <= 0) {
    // This will happen on a severed incomplete file
    // $FlowFixMe
    return null;
  }

  const buffer = new Uint8Array(slpFile.metadataLength);

  await readRef(slpFile.ref, buffer, 0, buffer.length, slpFile.metadataPosition);

  let metadata = null;
  try {
    metadata = decode(buffer);
  } catch (ex) {
    // Do nothing
    // console.log(ex);
  }

  // $FlowFixMe
  return metadata;
}
