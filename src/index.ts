import { loadConfig } from "./config";

export function main(): void {
  loadConfig();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
