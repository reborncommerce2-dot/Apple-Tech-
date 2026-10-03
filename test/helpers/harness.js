// Carga config.js + services.js en un sandbox de Node con un cliente Supabase (falso) y localStorage en memoria.
const vm = require("vm");
const fs = require("fs");
const path = require("path");

let total = 0, failed = 0;
function assert(cond, msg) {
  total += 1;
  if (cond) console.log("  OK  " + msg);
  else { failed += 1; console.log("FALLO  " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }
function summary() {
  console.log("\n----------------------------------------");
  console.log("Total: " + total + "   OK: " + (total - failed) + "   FALLOS: " + failed);
  console.log("----------------------------------------");
  return failed;
}
function makeStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
    _data: data,
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeSandbox(client, opts) {
  const o = opts || {};
  const sandbox = {
    localStorage: o.localStorage || makeStorage(),
    console: o.quiet === false ? console : { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout,
    window: { supabaseClient: client || null, supabaseClientError: client ? undefined : "sin cliente" },
  };
  vm.createContext(sandbox);
  ["config.js", "services.js"].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8"), sandbox, { filename: f }));
  sandbox.run = (code) => vm.runInContext(code, sandbox);
  return sandbox;
}

/* Siembra la base falsa con la configuración de fábrica (como "Cargar datos de ejemplo"). */
async function seedFactory(backend, sb) {
  const admin = backend.addUser("seed@x.com", "seedpass1", true);
  const c = backend.createClient();
  await c.auth.signInWithPassword({ email: "seed@x.com", password: "seedpass1" });
  const s = makeSandbox(c);
  await s.run("StorageService.init({admin:true})");
  s.run("backupService.restoreFactoryDefaults()");
  await s.run("StorageService.waitIdle()");
  await c.auth.signOut();
  return admin;
}
module.exports = { assert, section, summary, makeStorage, makeSandbox, sleep, seedFactory };
