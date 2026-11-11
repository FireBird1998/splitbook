// A separate Next server needs the same clock as its parent integration test.
const instant = Number(process.env.SPLITBOOK_READ_TEST_CLOCK);
if (!Number.isFinite(instant)) throw new Error('The read test server needs its clock');
const OriginalDate = globalThis.Date;
globalThis.Date = new Proxy(OriginalDate, {
  construct(target, args, constructor) {
    return Reflect.construct(target, args.length ? args : [instant], constructor);
  },
  apply() {
    return new OriginalDate(instant).toString();
  },
  get(target, property, receiver) {
    return property === 'now' ? () => instant : Reflect.get(target, property, receiver);
  },
});
