// Finance Tracker API — auth, admin user CRUD, one-time invite codes, per-user data.
// Storage: Netlify Blobs (no external database / account needed).
//
// Required env vars (Netlify -> Site configuration -> Environment variables):
//   SESSION_SECRET   long random string used to sign login tokens
//   ADMIN_PASSWORD   password for the first admin account (created on first admin login)
// Optional:
//   ADMIN_USERNAME   defaults to "admin"

import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DATA_BYTES = 1_000_000;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

const res = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const fail = (status, error) => res(status, { error });

// ---------- stores ----------
const users = () => getStore({ name: "users", consistency: "strong" });
const codes = () => getStore({ name: "codes", consistency: "strong" });
const userData = () => getStore({ name: "userdata", consistency: "strong" });

// ---------- crypto helpers ----------
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is not set (min 16 chars)");
  return s;
}
const b64 = (buf) => Buffer.from(buf).toString("base64url");

function signToken(username) {
  const payload = b64(JSON.stringify({ u: username, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() ? data.u : null;
  } catch { return null; }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}
function checkPassword(password, rec) {
  const hash = crypto.scryptSync(password, Buffer.from(rec.salt, "hex"), 64);
  const stored = Buffer.from(rec.hash, "hex");
  return hash.length === stored.length && crypto.timingSafeEqual(hash, stored);
}

function generateCode() {
  let c = "";
  for (let i = 0; i < 10; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return c; // stored/keyed without dash; shown as XXXXX-XXXXX
}
const normCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const prettyCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;

// ---------- validation ----------
function validUsername(u) { return typeof u === "string" && USERNAME_RE.test(u); }
function validPassword(p) { return typeof p === "string" && p.length >= 8 && p.length <= 128; }
const keyOf = (u) => u.toLowerCase();

const publicUser = (u) => ({
  username: u.username, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt,
});

// ---------- user helpers ----------
async function getUser(username) {
  if (!username) return null;
  return (await users().get(keyOf(username), { type: "json" })) || null;
}

async function ensureAdminBootstrap() {
  const name = process.env.ADMIN_USERNAME || "admin";
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return;
  const existing = await getUser(name);
  if (existing) return;
  const { salt, hash } = hashPassword(pw);
  await users().setJSON(
    keyOf(name),
    { username: name, role: "admin", salt, hash, createdAt: new Date().toISOString() },
    { onlyIfNew: true }
  );
}

async function authenticate(req) {
  const h = req.headers.get("authorization") || "";
  const username = verifyToken(h.startsWith("Bearer ") ? h.slice(7) : "");
  if (!username) return null;
  const user = await getUser(username);
  if (!user || user.disabled) return null; // deleted/disabled users lose access immediately
  return user;
}

async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

// ---------- handlers ----------
async function login(req) {
  const { username, password } = await readBody(req);
  if (typeof username !== "string" || typeof password !== "string") return fail(400, "Username and password required");
  await ensureAdminBootstrap();
  const user = await getUser(username);
  // same error for unknown user / wrong password
  if (!user || user.disabled || !checkPassword(password, user)) return fail(401, "Invalid username or password");
  return res(200, { token: signToken(user.username), user: publicUser(user) });
}

async function register(req) {
  const { username, password, code } = await readBody(req);
  if (!validUsername(username)) return fail(400, "Username must be 3-24 characters: letters, numbers, . _ -");
  if (!validPassword(password)) return fail(400, "Password must be at least 8 characters");
  const ck = normCode(code);
  if (ck.length !== 10) return fail(400, "Invalid registration code");

  if (await getUser(username)) return fail(409, "That username is already taken");

  // 1) atomically claim the code (only one request can win)
  const store = codes();
  const found = await store.getWithMetadata(ck, { type: "json" });
  if (!found || !found.data) return fail(400, "Invalid registration code");
  if (found.data.usedBy) return fail(400, "This registration code has already been used");
  const claimed = { ...found.data, usedBy: username, usedAt: new Date().toISOString() };
  const claim = await store.setJSON(ck, claimed, { onlyIfMatch: found.etag });
  if (claim && claim.modified === false) return fail(400, "This registration code has already been used");

  // 2) create the user (onlyIfNew guards against duplicate usernames)
  const { salt, hash } = hashPassword(password);
  const rec = { username, role: "user", salt, hash, createdAt: new Date().toISOString(), code: ck };
  const made = await users().setJSON(keyOf(username), rec, { onlyIfNew: true });
  if (made && made.modified === false) {
    await store.setJSON(ck, { ...found.data }); // release the code
    return fail(409, "That username is already taken");
  }
  return res(201, { token: signToken(username), user: publicUser(rec) });
}

async function changeOwnPassword(req, me) {
  const { currentPassword, newPassword } = await readBody(req);
  if (!checkPassword(String(currentPassword || ""), me)) return fail(401, "Current password is incorrect");
  if (!validPassword(newPassword)) return fail(400, "New password must be at least 8 characters");
  await users().setJSON(keyOf(me.username), { ...me, ...hashPassword(newPassword) });
  return res(200, { ok: true });
}

async function getData(me) {
  const data = await userData().get(keyOf(me.username), { type: "json" });
  return res(200, { data: data || null });
}
async function putData(req, me) {
  const raw = await req.text();
  if (raw.length > MAX_DATA_BYTES) return fail(413, "Data too large");
  let body; try { body = JSON.parse(raw); } catch { return fail(400, "Invalid JSON"); }
  if (!body || typeof body.data !== "object" || body.data === null) return fail(400, "Missing data");
  await userData().setJSON(keyOf(me.username), body.data);
  return res(200, { ok: true });
}

// ---------- admin ----------
async function listAll(store) {
  const { blobs } = await store.list();
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}
async function adminCountActive() {
  return (await listAll(users())).filter((u) => u.role === "admin" && !u.disabled).length;
}

async function admin(req, me, parts) {
  if (me.role !== "admin") return fail(403, "Admin only");
  const [, section, id] = parts; // ["admin", "users"|"codes", id?]
  const method = req.method;

  if (section === "users") {
    if (method === "GET" && !id) {
      const list = (await listAll(users())).map(publicUser)
        .sort((a, b) => a.username.localeCompare(b.username));
      return res(200, { users: list });
    }
    if (method === "POST" && !id) {
      const { username, password, role } = await readBody(req);
      if (!validUsername(username)) return fail(400, "Invalid username");
      if (!validPassword(password)) return fail(400, "Password must be at least 8 characters");
      const r = role === "admin" ? "admin" : "user";
      const { salt, hash } = hashPassword(password);
      const rec = { username, role: r, salt, hash, createdAt: new Date().toISOString() };
      const made = await users().setJSON(keyOf(username), rec, { onlyIfNew: true });
      if (made && made.modified === false) return fail(409, "Username already exists");
      return res(201, { user: publicUser(rec) });
    }
    if (id && (method === "PUT" || method === "DELETE")) {
      const target = await getUser(decodeURIComponent(id));
      if (!target) return fail(404, "User not found");
      const isSelf = keyOf(target.username) === keyOf(me.username);

      if (method === "DELETE") {
        if (isSelf) return fail(400, "You cannot delete your own account");
        if (target.role === "admin" && !target.disabled && (await adminCountActive()) <= 1)
          return fail(400, "Cannot delete the last admin");
        await users().delete(keyOf(target.username));
        await userData().delete(keyOf(target.username));
        return res(200, { ok: true });
      }

      const { password, role, disabled } = await readBody(req);
      const next = { ...target };
      if (password !== undefined) {
        if (!validPassword(password)) return fail(400, "Password must be at least 8 characters");
        Object.assign(next, hashPassword(password));
      }
      if (role !== undefined) next.role = role === "admin" ? "admin" : "user";
      if (disabled !== undefined) next.disabled = !!disabled;
      const losingAdmin = target.role === "admin" && !target.disabled && (next.role !== "admin" || next.disabled);
      if (losingAdmin) {
        if (isSelf) return fail(400, "You cannot demote or disable yourself");
        if ((await adminCountActive()) <= 1) return fail(400, "Cannot remove the last admin");
      }
      await users().setJSON(keyOf(target.username), next);
      return res(200, { user: publicUser(next) });
    }
  }

  if (section === "codes") {
    if (method === "GET" && !id) {
      const list = (await listAll(codes()))
        .map((c) => ({ code: prettyCode(c.code), note: c.note || "", createdAt: c.createdAt, usedBy: c.usedBy || null, usedAt: c.usedAt || null }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return res(200, { codes: list });
    }
    if (method === "POST" && !id) {
      const { count, note } = await readBody(req);
      const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 20);
      const created = [];
      for (let i = 0; i < n; i++) {
        const code = generateCode();
        const rec = { code, note: String(note || "").slice(0, 60), createdAt: new Date().toISOString(), createdBy: me.username };
        await codes().setJSON(code, rec, { onlyIfNew: true });
        created.push(prettyCode(code));
      }
      return res(201, { codes: created });
    }
    if (method === "DELETE" && id) {
      await codes().delete(normCode(decodeURIComponent(id)));
      return res(200, { ok: true });
    }
  }
  return fail(404, "Not found");
}

// ---------- router ----------
export default async (req) => {
  try {
    const parts = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const route = parts[0];
    const method = req.method;

    if (route === "login" && method === "POST") return await login(req);
    if (route === "register" && method === "POST") return await register(req);

    const me = await authenticate(req);
    if (!me) return fail(401, "Not signed in");

    if (route === "me" && method === "GET") return res(200, { user: publicUser(me) });
    if (route === "password" && method === "POST") return await changeOwnPassword(req, me);
    if (route === "data" && method === "GET") return await getData(me);
    if (route === "data" && method === "PUT") return await putData(req, me);
    if (route === "admin") return await admin(req, me, parts);

    return fail(404, "Not found");
  } catch (err) {
    console.error(err);
    return fail(500, err.message.includes("SESSION_SECRET") ? err.message : "Server error");
  }
};
