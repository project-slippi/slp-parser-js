import fs from "fs";
import { openSlpFile, SlpInputSource } from "../src/utils/slpReader";
import { SlpFileWriter, SlippiGame } from "../src";
import { Writable } from "stream";

// On my machine, >100 is required to give the slpFile.ts "finish" callback time to execute.
// I thought a 'yield' 0 ms setTimout would allow the callback to execute, but that's not the case.
const TIMEOUT_MS = 1000;

describe("when ending SlpFileWriter", () => {
  it("should write data length to file", async () => {
    const testFilePath = "slp/finalizedFrame.slp";

    const slpFileWriter = new SlpFileWriter();
    const slpFile = openSlpFile({ source: SlpInputSource.FILE, filePath: testFilePath });
    const dataLength = slpFile.rawDataLength;
    const dataPos = slpFile.rawDataPosition;

    const testFd = fs.openSync(testFilePath, "r");
    const newPos = pipeMessageSizes(testFd, dataPos, slpFileWriter);
    const newFilename = slpFileWriter.getCurrentFilename();

    pipeAllEvents(testFd, newPos, dataPos + dataLength, slpFileWriter, slpFile.messageSizes);
    await new Promise((resolve): void => {
      setTimeout(() => {
        const writtenDataLength = openSlpFile({ source: SlpInputSource.FILE, filePath: newFilename }).rawDataLength;
        fs.unlinkSync(newFilename);

        expect(writtenDataLength).toBe(dataLength);

        resolve();
      }, TIMEOUT_MS);
    });
  });

  it("should track and write player data to metadata in file", async () => {
    const testFilePath = "slp/finalizedFrame.slp";

    const slpFileWriter = new SlpFileWriter();
    const slpFile = openSlpFile({ source: SlpInputSource.FILE, filePath: testFilePath });
    const dataPos = slpFile.rawDataPosition;

    const testFd = fs.openSync(testFilePath, "r");
    const newPos = pipeMessageSizes(testFd, dataPos, slpFileWriter);
    const newFilename = slpFileWriter.getCurrentFilename();

    pipeAllEvents(testFd, newPos, dataPos + slpFile.rawDataLength, slpFileWriter, slpFile.messageSizes);
    await new Promise((resolve): void => {
      setTimeout(() => {
        const players = new SlippiGame(newFilename).getMetadata().players;
        fs.unlinkSync(newFilename);

        expect(Object.keys(players).length).toBe(2);
        expect(players[0].characters).toEqual({ 0: 17558 });
        expect(players[1].characters).toEqual({ 1: 17558 });

        resolve();
      }, TIMEOUT_MS);
    });
  });
});

const pipeMessageSizes = function (fd: number, start: number, writeStream: Writable): number {
  let pos = start;
  const commandByteBuffer = new Uint8Array(2);
  fs.readSync(fd, commandByteBuffer, 0, 2, pos);
  const length = commandByteBuffer[1] + 1;

  const buffer = new Uint8Array(length);
  fs.readSync(fd, buffer, 0, length, pos);

  pos += length;
  writeStream.write(buffer);

  return pos;
};

const pipeAllEvents = function (
  fd: number,
  start: number,
  end: number,
  writeStream: Writable,
  messageSizes: {
    [command: number]: number;
  },
): void {
  let pos = start;
  while (pos < end) {
    const commandByteBuffer = new Uint8Array(1);
    fs.readSync(fd, commandByteBuffer, 0, 1, pos);
    const length = messageSizes[commandByteBuffer[0]] + 1;

    const buffer = new Uint8Array(length);
    fs.readSync(fd, buffer, 0, length, pos);

    pos += length;
    writeStream.write(buffer);
  }
};
