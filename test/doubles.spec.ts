import { SlippiGame } from "../src";

describe("when parsing doubles games", () => {
  it("should correctly handle when players are eliminated", async () => {
    const game = new SlippiGame("slp/doubles.slp");
    const settings = await game.getSettings();
    const metadata = await game.getMetadata();
    expect(settings.players.length).toBe(4);
    const p1ElimFrame = 7754;
    const p1StockStealFrame = 7783;
    const p1ElimFrame2 = 8236;
    const gameEndFrame = metadata.lastFrame;

    const frames = await game.getFrames();
    // Check that p1 still has a frame when they get eliminated
    expect(frames[p1ElimFrame].players[0]).toBeTruthy();

    // Check that eliminated frames are falsey
    for (let i = p1ElimFrame + 1; i < p1StockStealFrame; i++) {
      expect(frames[i].players[0]).toBeFalsy();
    }

    // After the player steals the stock, they should be truthy again
    for (let i = p1StockStealFrame; i <= p1ElimFrame2; i++) {
      expect(frames[i].players[0]).toBeTruthy();
    }

    // Check that eliminated frames are falsey again when they lose their last stock
    for (let i = p1ElimFrame2 + 1; i <= gameEndFrame; i++) {
      expect(frames[i].players[0]).toBeFalsy();
    }
  });
});
