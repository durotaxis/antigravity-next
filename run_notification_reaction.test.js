const { createNotificationReaction } = require('./run_notification_reaction');

test.each([
  '全体。1分毎テーブル所見: 後半も元気。',
  '全体。 **1分毎テーブル所見：** 後半も元気。\n\n次回の助言',
  '1分毎テーブル所見:\r\n後半も元気。\r\n## 次回\n助言',
])('sends only minute findings to the reaction generator', async message => {
  const generate = jest.fn(async () => 'すごい！');
  expect(await createNotificationReaction(generate)(message)).toBe('すごい！');
  expect(generate).toHaveBeenCalledWith('後半も元気。');
});

test('missing findings skip Gemini; failed Gemini returns no reaction', async () => {
  const generate = jest.fn(async () => { throw new Error('blocked'); });
  const reaction = createNotificationReaction(generate, jest.fn());
  expect(await reaction(['全体だけ', '1分毎テーブル所見: データなし'])).toBe('');
  expect(generate).not.toHaveBeenCalled();
  expect(await reaction('1分毎テーブル所見: 後半も元気。')).toBe('');
});
