#!/usr/bin/env node
import { createStockResearchService } from "./service.ts";
import { runJsonRpcStdio } from "./json-rpc.ts";

const service = createStockResearchService();

await runJsonRpcStdio({
  input: process.stdin,
  output: process.stdout,
  service,
});
