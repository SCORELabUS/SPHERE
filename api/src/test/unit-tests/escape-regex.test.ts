import { describe, it, expect } from 'vitest';
import { escapeRegex } from '../../main/utils/regex';

describe('escapeRegex', () => {
  it('should return plain strings unchanged', () => {
    expect(escapeRegex('hello')).toBe('hello');
    expect(escapeRegex('abc123')).toBe('abc123');
    expect(escapeRegex('No special chars here')).toBe('No special chars here');
  });

  it('should escape dot (.)', () => {
    expect(escapeRegex('file.txt')).toBe('file\\.txt');
    expect(escapeRegex('a.b.c')).toBe('a\\.b\\.c');
  });

  it('should escape asterisk (*)', () => {
    expect(escapeRegex('test*')).toBe('test\\*');
    expect(escapeRegex('*test')).toBe('\\*test');
  });

  it('should escape plus (+)', () => {
    expect(escapeRegex('c++')).toBe('c\\+\\+');
  });

  it('should escape question mark (?)', () => {
    expect(escapeRegex('really?')).toBe('really\\?');
  });

  it('should escape caret (^)', () => {
    expect(escapeRegex('^start')).toBe('\\^start');
  });

  it('should escape dollar sign ($)', () => {
    expect(escapeRegex('end$')).toBe('end\\$');
  });

  it('should escape curly braces ({})', () => {
    expect(escapeRegex('{n}')).toBe('\\{n\\}');
  });

  it('should escape parentheses', () => {
    expect(escapeRegex('foo(bar)')).toBe('foo\\(bar\\)');
  });

  it('should escape pipe (|)', () => {
    expect(escapeRegex('a|b')).toBe('a\\|b');
  });

  it('should escape square brackets ([])', () => {
    expect(escapeRegex('[test]')).toBe('\\[test\\]');
    expect(escapeRegex('[a-z]')).toBe('\\[a-z\\]');
  });

  it('should escape backslash (\\)', () => {
    expect(escapeRegex('path\\to')).toBe('path\\\\to');
  });

  it('should escape all special regex characters together', () => {
    const input = 'test.*+?^${}()|[]\\';
    const escaped = escapeRegex(input);
    expect(escaped).toBe('test\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('should produce a regex that matches the literal string', () => {
    const input = 'Price (USD) $10.00';
    const escaped = escapeRegex(input);
    const regex = new RegExp(escaped, 'i');
    expect(regex.test(input)).toBe(true);
    expect(regex.test('price (usd) $10.00')).toBe(true);
  });

  it('should produce a regex that does not match different strings', () => {
    const escaped = escapeRegex('Test.');
    const regex = new RegExp(escaped, 'i');
    expect(regex.test('Test.')).toBe(true);
    expect(regex.test('Test')).toBe(false);
    expect(regex.test('TestX')).toBe(false);
  });

  it('should not create unintended matches with special characters', () => {
    const escaped = escapeRegex('C++');
    const regex = new RegExp(escaped, 'i');
    expect(regex.test('C++')).toBe(true);
    expect(regex.test('C')).toBe(false);
    expect(regex.test('CXX')).toBe(false);
  });

  it('should handle empty string', () => {
    expect(escapeRegex('')).toBe('');
  });

  it('should handle string with only special characters', () => {
    expect(escapeRegex('.*+?')).toBe('\\.\\*\\+\\?');
  });
});
