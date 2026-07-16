#!/usr/bin/env node
import { createStockResearchServiceFromEnvironment } from "./config.ts";
import { runJsonRpcStdio } from "./json-rpc.ts";

const service = createStockResearchServiceFromEnvironment();

await runJsonRpcStdio({
  input: process.stdin,
  output: process.stdout,
  service,
});
