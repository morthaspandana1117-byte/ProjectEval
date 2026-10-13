import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/Users.js";
import { forbidden, unauthorized } from "../utils/http.js";

export const SESSION_COOKIE = "pe_session";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
  };
}

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user._id.toString(), tv: user.tokenVersion ?? 0 }, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: env.jwtExpiresIn,
  });
  const decoded = jwt.decode(token);
  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: (decoded.exp - decoded.iat) * 1000,
  });
}

export function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** Loads the signed-in user from the session cookie; rejects missing, expired or revoked sessions. */
export async function authenticate(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    throw unauthorized("Your session has expired. Please sign in again.");
  }

  const user = await User.findById(payload.sub).select("+tokenVersion");
  if (!user || user.tokenVersion !== payload.tv) {
    throw unauthorized("Your session is no longer valid. Please sign in again.");
  }
  if (!user.isActive) throw forbidden("Your account has been deactivated. Contact the administrator.");

  req.user = user;
  next();
}

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}
