import path from "node:path";
import { fileURLToPath } from "node:url";

// 启动时加载本地 .env（server/.env 优先，其次仓库根目录 .env）。
// 与 Node --env-file 语义一致：已存在的环境变量不会被文件覆盖；
// 文件不存在时静默跳过，Railway 等平台直接用平台环境变量。
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const loadEnvFile = (process as { loadEnvFile?: (filePath: string) => void }).loadEnvFile?.bind(process);

if (loadEnvFile) {
  for (const candidate of [path.resolve(moduleDir, "../.env"), path.resolve(moduleDir, "../../.env")]) {
    try {
      loadEnvFile(candidate);
    } catch {
      // .env 不存在或不可读：忽略
    }
  }
}

// 禁止生产环境通过 NODE_TLS_REJECT_UNAUTHORIZED=0 关闭证书校验。
// 本地开发可能由企业代理临时注入该变量，因此只在发布环境硬阻断。
export const assertTlsVerificationEnabled = (env: Record<string, string | undefined> = process.env) => {
  if (env.NODE_ENV === "production" && env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("生产环境禁止设置 NODE_TLS_REJECT_UNAUTHORIZED=0；请配置可信 CA 后再启动服务");
  }
};

assertTlsVerificationEnabled();
