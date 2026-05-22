import jwt from 'jsonwebtoken';

const EXPIRY = '7d';

export function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: EXPIRY });
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}
