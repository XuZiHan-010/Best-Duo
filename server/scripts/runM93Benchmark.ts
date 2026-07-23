import { runM93Benchmark } from "../src/agentlab/benchmark.js";

const raw = process.argv.find((argument) => argument.startsWith("--seeds-per-level="));
const seedsPerLevel = raw ? Number(raw.split("=")[1]) : 60;
if (!Number.isInteger(seedsPerLevel) || seedsPerLevel <= 0) {
  throw new Error("--seeds-per-level 必须是正整数");
}

const report = await runM93Benchmark({ seedsPerLevel });
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.releaseGatePass ? 0 : 1;
