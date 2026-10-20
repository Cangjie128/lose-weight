import { spawn } from "node:child_process";
import { cp,mkdir,readFile,writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../",import.meta.url));
const dist = resolve(root,".next-v2");
const marker = resolve(dist,"isolated-preview.json");
const env = { ...process.env,LOCAL_PREVIEW_DIR: ".next-v2",NODE_ENV: "production",NEXT_PUBLIC_SUPABASE_URL: "",NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",DEEPSEEK_API_KEY: "",OPENAI_API_KEY: "",GOOGLE_CLIENT_ID: "",GOOGLE_CLIENT_SECRET: "",INTEGRATION_ENCRYPTION_KEY: "",AI_ALLOW_OPENAI_FALLBACK: "false" };
function run(file,args,options = {}) {
  return new Promise((resolve,reject) => {
    const child = spawn(process.execPath,[file,...args],{ cwd: root,env,stdio: "inherit",...options });
    child.on("error",reject); child.on("exit",(code) => code === 0 ? resolve() : reject(new Error(`Process exited with ${code}`)));
  });
}
if (!process.argv.includes("--serve-built")) {
  await run(resolve(root,"node_modules/next/dist/bin/next"),["build"]);
  await writeFile(marker,JSON.stringify({ isolated: true,created_at: new Date().toISOString() }));
} else {
  const metadata = JSON.parse(await readFile(marker,"utf8"));
  if (!metadata.isolated) throw new Error("Build the isolated preview with npm run build:v2 first.");
}
if (!process.argv.includes("--build-only")) {
  let port = Number(process.env.PREVIEW_PORT) || 3004;
  async function available(value) {
    return new Promise((resolve) => {
      const test = createServer(); test.once("error",() => resolve(false));
      test.listen(value,"127.0.0.1",() => test.close(() => resolve(true)));
    });
  }
  const original = port;
  while (!await available(port)) { port++; if (port-original > 20) throw new Error("No local preview port is available."); }
  env.PORT = String(port); env.HOSTNAME = "127.0.0.1"; env.APP_ORIGIN = `http://127.0.0.1:${port}`;
  await mkdir(resolve(dist,"standalone/.next-v2/static"),{ recursive: true });
  await cp(resolve(dist,"static"),resolve(dist,"standalone/.next-v2/static"),{ recursive: true,force: true });
  await cp(resolve(root,"public"),resolve(dist,"standalone/public"),{ recursive: true,force: true });
  console.log(`Isolated V2 preview: http://127.0.0.1:${port}/`);
  await run(resolve(dist,"standalone/server.js"),[]);
}
