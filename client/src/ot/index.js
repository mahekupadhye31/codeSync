/**
 * Client-side OT transform — mirrors server/src/ot/index.js exactly.
 *
 * Used to transform incoming remote ops against locally pending (sent but
 * not yet acked) ops so the local document stays consistent.
 *
 * Op shapes:
 *   { type:'insert', position, content, userId, revision }
 *   { type:'delete', position, length,  userId, revision }
 */

export function transform(op1, op2) {
  if (!op1 || !op2) return op1;
  if (op1.type === 'insert' && op2.type === 'insert') return _ii(op1, op2);
  if (op1.type === 'insert' && op2.type === 'delete') return _id(op1, op2);
  if (op1.type === 'delete' && op2.type === 'insert') return _di(op1, op2);
  if (op1.type === 'delete' && op2.type === 'delete') return _dd(op1, op2);
  return op1;
}

function _ii(op1, op2) {
  if (op2.position < op1.position) {
    return { ...op1, position: op1.position + op2.content.length };
  }
  if (op2.position === op1.position) {
    const u1 = op1.userId ?? '';
    const u2 = op2.userId ?? '';
    if (u2 <= u1) return { ...op1, position: op1.position + op2.content.length };
  }
  return op1;
}

function _id(insert, del) {
  const delEnd = del.position + del.length;
  if (del.position >= insert.position) return insert;
  if (delEnd <= insert.position) return { ...insert, position: insert.position - del.length };
  // Insert inside deleted range — delete wins, discard the insert (return null = no-op)
  return null;
}

function _di(del, insert) {
  const delEnd = del.position + del.length;
  if (insert.position <= del.position) return { ...del, position: del.position + insert.content.length };
  if (insert.position >= delEnd) return del;
  return { ...del, length: del.length + insert.content.length };
}

function _dd(op1, op2) {
  const op1End = op1.position + op1.length;
  const op2End = op2.position + op2.length;
  if (op2End <= op1.position) return { ...op1, position: op1.position - op2.length };
  if (op2.position >= op1End) return op1;
  const overlap   = Math.min(op1End, op2End) - Math.max(op1.position, op2.position);
  const newLength = op1.length - overlap;
  if (newLength <= 0) return null;
  const newPosition = op2.position < op1.position ? op2.position : op1.position;
  return { ...op1, position: newPosition, length: newLength };
}
