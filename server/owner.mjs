import { configureOwner, renameOwner } from "./auth.mjs";
import { openStore } from "./store.mjs";

process.umask(0o077);
const [command, username] = process.argv.slice(2);
const directory = process.env.LIFEDIARY_DATA_DIR;
if (!directory || !["init", "reset", "rename"].includes(command)) {
  throw new Error("Set LIFEDIARY_DATA_DIR. Use scripts/private-owner.sh init|reset ACCOUNT, or node server/owner.mjs rename ACCOUNT.");
}
if (command === "rename") {
  const store = openStore(directory);
  try {
    const changed = renameOwner(store, username);
    console.log(changed ? "账号名已修改，请用新账号名重新登录。" : "当前账号名已是该名称。");
  } finally { store.db.close(); }
} else {
  if (process.stdin.isTTY) throw new Error("Use scripts/private-owner.sh to enter the password privately.");
  const chunks = [];
  let count = 0;
  for await (const chunk of process.stdin) {
    count += chunk.length;
    if (count > 256) throw new Error("Password is too long.");
    chunks.push(chunk);
  }
  const store = openStore(directory, { initialize: command === "init" });
  try {
    const secret = await configureOwner(store, username, Buffer.concat(chunks).toString("utf8"), command === "reset");
    console.log("在验证器添加基于时间的账户（6 位，30 秒，SHA-1）。请在此终端读取密钥并保存在自己的验证器中。");
    console.log(secret);
  } finally { store.db.close(); }
}
