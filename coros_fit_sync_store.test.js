const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { ensureFitSignature, persistCorosFitActivity } = require('./coros_fit_sync_store');

function validFitBytes() {
  const bytes = Buffer.alloc(16);
  bytes[0] = 14;
  bytes.write('.FIT', 8, 'ascii');
  return bytes;
}

describe('COROS FIT persistence', () => {
  test('rejects a file without a FIT signature', () => {
    expect(() => ensureFitSignature(Buffer.from('not a fit'))).toThrow('FIT');
  });

  test('does not update state when FIT signature validation fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coros-fit-store-'));
    const statePath = path.join(root, 'state.json');
    await expect(persistCorosFitActivity({
      activity: { labelId: 'bad-fit', sportType: 100, date: '2026-07-21' },
      fitBytes: Buffer.from('not a fit'),
      statePath
    })).rejects.toThrow('FIT');
    await expect(fs.access(statePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
