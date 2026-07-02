/**
 * OT convergence tests — mirrors src/ot/index.test.js exactly so the
 * CI test suite exercises the algorithm without needing a running server.
 * Run: node --test tests/ot.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform, applyOp, compose } from '../src/ot/index.js';

function apply(doc, op) { return applyOp(doc, op); }

function convergence(doc, op1, op2) {
  const op2First = apply(doc, op2);
  const op1t     = transform(op1, op2);
  return apply(op2First, op1t);
}

// ── insert × insert ───────────────────────────────────────────────────────────
test('insert before insert shifts right', () => {
  const op1  = { type: 'insert', position: 5, content: 'B', userId: 'u1' };
  const op2  = { type: 'insert', position: 2, content: 'AA', userId: 'u2' };
  const op1t = transform(op1, op2);
  assert.equal(op1t.position, 7);
});

test('same-position inserts tie-break by userId (lower goes first)', () => {
  const op1  = { type: 'insert', position: 3, content: 'X', userId: 'u2' };
  const op2  = { type: 'insert', position: 3, content: 'Y', userId: 'u1' };
  const op1t = transform(op1, op2);
  assert.equal(op1t.position, 4);
});

test('same-position inserts converge', () => {
  const doc = 'ABCDE';
  const op1  = { type: 'insert', position: 2, content: 'X', userId: 'u1' };
  const op2  = { type: 'insert', position: 2, content: 'Y', userId: 'u2' };
  const r1   = convergence(doc, op1, op2);
  const r2   = convergence(doc, op2, op1);
  assert.equal(r1, r2, `Both paths must produce same doc (got "${r1}" vs "${r2}")`);
});

// ── delete × insert ───────────────────────────────────────────────────────────
test('delete swallows insert that falls inside its range', () => {
  const del    = { type: 'delete', position: 1, length: 3 };
  const insert = { type: 'insert', position: 2, content: 'X' };
  const delt   = transform(del, insert);
  assert.equal(delt.position, 1);
  assert.equal(delt.length,   4);
});

test('delete × insert convergence: both paths produce "AE" (delete wins)', () => {
  const doc = 'ABCDE';
  const del  = { type: 'delete', position: 1, length: 3, userId: 'u1' };
  const ins  = { type: 'insert', position: 2, content: 'X', userId: 'u2' };
  const r1   = convergence(doc, del, ins);
  const r2   = convergence(doc, ins, del);
  assert.equal(r1, r2, `Paths diverge: path-A="${r1}" path-B="${r2}"`);
  assert.equal(r1, 'AE');
});

// ── insert × delete ───────────────────────────────────────────────────────────
test('insert inside deleted range returns null (delete wins)', () => {
  const ins  = { type: 'insert', position: 3, content: 'X' };
  const del  = { type: 'delete', position: 1, length: 5 };
  const inst = transform(ins, del);
  assert.equal(inst, null);
});

test('insert after delete shifts left', () => {
  const ins  = { type: 'insert', position: 8, content: 'X' };
  const del  = { type: 'delete', position: 2, length: 3 };
  const inst = transform(ins, del);
  assert.equal(inst.position, 5);
});

// ── delete × delete ───────────────────────────────────────────────────────────
test('non-overlapping delete before shifts left', () => {
  const op1  = { type: 'delete', position: 6, length: 2 };
  const op2  = { type: 'delete', position: 1, length: 3 };
  const op1t = transform(op1, op2);
  assert.equal(op1t.position, 3);
  assert.equal(op1t.length,   2);
});

test('overlapping deletes produce no-op when fully covered', () => {
  const op1  = { type: 'delete', position: 2, length: 3 };
  const op2  = { type: 'delete', position: 1, length: 5 };
  const op1t = transform(op1, op2);
  assert.equal(op1t, null);
});

test('partial overlap trims correctly', () => {
  const doc  = 'ABCDEFGH';
  const op1  = { type: 'delete', position: 2, length: 4, userId: 'u1' };
  const op2  = { type: 'delete', position: 4, length: 3, userId: 'u2' };
  const r1   = convergence(doc, op1, op2);
  const r2   = convergence(doc, op2, op1);
  assert.equal(r1, r2, `Convergence: "${r1}" vs "${r2}"`);
});

// ── compose ───────────────────────────────────────────────────────────────────
test('compose adjacent inserts', () => {
  const op1 = { type: 'insert', position: 0, content: 'Hello' };
  const op2 = { type: 'insert', position: 5, content: ' World' };
  const c   = compose(op1, op2);
  assert.equal(c?.content, 'Hello World');
});

test('compose consecutive deletes (forward)', () => {
  const op1 = { type: 'delete', position: 3, length: 2 };
  const op2 = { type: 'delete', position: 3, length: 1 };
  const c   = compose(op1, op2);
  assert.equal(c?.length, 3);
});
