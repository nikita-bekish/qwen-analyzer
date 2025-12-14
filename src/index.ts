import { CLI } from './cli';

async function main() {
  const cli = new CLI();
  await cli.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
