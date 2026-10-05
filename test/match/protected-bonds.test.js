import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameData } from '../../server/match/gamedata.js';
import { drawDisabledBonds, SharedPool } from '../../server/match/pool.js';
import { createRng } from '../../server/sim/rng.js';

const data = Object.fromEntries(['config', 'bonds', 'chess'].map((key) => [
  key, JSON.parse(readFileSync(new URL('../../data/' + key + '.json', import.meta.url), 'utf8')),
]));
const protectedBonds = ['egirShip', 'lateranoShip', 'indomShip'];

test('阿戈尔、拉特兰、不屈 stay enabled and their operators stay in the pool in every mode', () => {
  for (const mode of Object.values(data.config.modes)) {
    const gd = new GameData(data, mode.modeId);
    for (const bond of protectedBonds) {
      assert.ok(mode.activeBondIds.includes(bond), mode.modeId + ': active ' + bond);
      assert.ok(!gd.modeInactiveBonds.has(bond), mode.modeId + ': not inactive ' + bond);
    }
    for (let seed = 1; seed <= 100; seed++) {
      const bans = drawDisabledBonds(gd, createRng(seed));
      const expected = gd.bans(gd.difficulty);
      assert.equal(bans.drawn.filter((id) => gd.bond(id).isCore).length, expected.core);
      assert.equal(bans.drawn.filter((id) => !gd.bond(id).isCore).length, expected.addon);
      for (const bond of protectedBonds) {
        assert.ok(!bans.drawn.includes(bond));
        assert.ok(!bans.staticOff.includes(bond));
      }
      const pool = new SharedPool(gd, { banned: bans.banned });
      for (const id of gd.visibleChess) {
        if (gd.chess(id).bonds.some((b) => protectedBonds.includes(b))) {
          assert.ok(pool.has(id), mode.modeId + ': protected operator ' + id);
        }
      }
      assert.deepEqual(drawDisabledBonds(gd, createRng(seed)), bans, 'same seed remains deterministic');
    }
  }
});
