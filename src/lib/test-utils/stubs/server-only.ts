// No-op stand-in for the `server-only` package under Vitest.
// The real package throws unless the bundler sets the `react-server` export
// condition; tests run in plain Node, so the tripwire is aliased away here.
export {};
