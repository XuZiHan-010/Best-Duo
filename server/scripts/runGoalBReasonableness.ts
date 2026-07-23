import { runGoalBReasonableness } from "../src/agentlab/reasonablenessBenchmark.js";

const raw = process.argv.find((argument) => argument.startsWith("--seeds-per-level="));
const seedsPerLevel = raw ? Number(raw.split("=")[1]) : 60;
if (!Number.isInteger(seedsPerLevel) || seedsPerLevel <= 0) {
  throw new Error("--seeds-per-level 必须是正整数");
}

const report = runGoalBReasonableness({ seedsPerLevel });
console.log(JSON.stringify(report, null, 2));
// Goal B 合理队友验收：绝不「有安全选择却仍必输」，且提示既不超预算也不浪费。
const pass =
  report.overall.avoidableLosses === 0 &&
  report.hints.overBudgetReveals === 0 &&
  report.hints.wastefulReveals === 0;
process.exitCode = pass ? 0 : 1;
