// Plain JavaScript, so an older Node gets this message instead of a syntax error. Node
// 22.18 runs the TypeScript sources directly, and Effect 4 needs it.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`tools/swarm needs Node 22.18 or later; this is Node ${process.versions.node}.`);
  process.exit(1);
}
await import('../src/main.ts');
