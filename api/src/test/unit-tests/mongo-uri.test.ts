import { describe, it, expect } from 'vitest';
import { redactMongoUri } from '../../main/utils/mongo-uri';

describe('redactMongoUri', () => {
  it('masks the password and keeps user, host, database and options', () => {
    expect(redactMongoUri('mongodb://sphere:s3cret@mongodb:27017/sphere?authSource=sphere'))
      .toBe('mongodb://sphere:***@mongodb:27017/sphere?authSource=sphere');
  });

  it('masks the password of an SRV URI', () => {
    expect(redactMongoUri('mongodb+srv://admin:pa55@cluster0.example.net/sphere'))
      .toBe('mongodb+srv://admin:***@cluster0.example.net/sphere');
  });

  it('masks a password holding @, : or /', () => {
    const uri = 'mongodb://sphere:p@ss:w/rd@mongodb:27017/sphere?authSource=sphere';
    const redacted = redactMongoUri(uri);
    expect(redacted).toBe('mongodb://sphere:***@mongodb:27017/sphere?authSource=sphere');
    expect(redacted).not.toContain('p@ss');
  });

  it('masks the password with several hosts', () => {
    expect(redactMongoUri('mongodb://u:pw@h1:27017,h2:27017/db?replicaSet=rs0'))
      .toBe('mongodb://u:***@h1:27017,h2:27017/db?replicaSet=rs0');
  });

  it('leaves URIs without a password unchanged', () => {
    expect(redactMongoUri('mongodb://localhost:27017/sphere?authSource=sphere'))
      .toBe('mongodb://localhost:27017/sphere?authSource=sphere');
    expect(redactMongoUri('mongodb://user@localhost:27017/sphere'))
      .toBe('mongodb://user@localhost:27017/sphere');
  });

  it('ignores an @ in the query string', () => {
    expect(redactMongoUri('mongodb://localhost:27017/db?appName=a@b'))
      .toBe('mongodb://localhost:27017/db?appName=a@b');
  });

  it('leaves strings that are not URIs unchanged', () => {
    expect(redactMongoUri('not a uri')).toBe('not a uri');
  });
});
