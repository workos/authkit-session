import { once } from './utils';

describe('utils', () => {
  describe('once', () => {
    it('only allows the provided function to be called once, caching its result', () => {
      let num = 0;
      const fn = once(() => ++num);
      expect(fn()).toEqual(1);
      expect(fn()).toEqual(1); // test it's the same on every call
    });
  });
});
