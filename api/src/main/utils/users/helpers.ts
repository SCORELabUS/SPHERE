import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'sphere-default-secret-change-in-production';
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '24h';

interface JwtPayload {
  id: string;
  username: string;
  role: string;
}

function generateJwtToken(user: { id: string; username: string; role: string }): string {
  const payload: JwtPayload = { id: user.id, username: user.username, role: user.role };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION } as any);
}

function verifyJwtToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

function generateUserTokenDTO() {
  // Legacy: kept for backward compatibility during migration.
  // New auth flow uses JWT via generateJwtToken().
  return {
        token: crypto.randomBytes(20).toString('hex'),
        tokenExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
};

async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(5);
  const hash = await bcrypt.hash(password, salt);

  return hash;
}

function handleError(err: any): {status: number, message: string} {
  if (err.message.toLowerCase().includes('unauthorized')) {
    return { status: 401, message: err.message };
  } else if (err.message.toLowerCase().includes('permission error')) {
    return { status: 403, message: err.message };
  } else if (err.message.toLowerCase().includes('not found')) {
    return { status: 404, message: err.message };
  } else if (err.message.toLowerCase().includes('conflict')) {
    return { status: 409, message: err.message };
  } else if (err.message.toLowerCase().includes('authentication timeout')) {
    return { status: 419, message: err.message };
  } else if (err.message.toLowerCase().includes('invalid data')) {
    return { status: 422, message: err.message };
  } else {
    return { status: 500, message: err.message };
  }
}

export { generateUserTokenDTO, generateJwtToken, verifyJwtToken, handleError, hashPassword };