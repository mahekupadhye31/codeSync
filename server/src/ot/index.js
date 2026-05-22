/**
 * Operational Transformation engine.
 *
 * Operation shape:
 *   Insert: { type:'insert', position:number, content:string, userId?:string, revision:number }
 *   Delete: { type:'delete', position:number, length:number,  userId?:string, revision:number }
 *
 * transform(op1, op2) → op1'
 *   Returns op1 adjusted so it can be applied AFTER op2 has already been applied
 *   to the same base document.  Returns null if op1 becomes a no-op.
 *
 * Tie-breaking rule: when two inserts land at the exact same position, the one
 * with the lexicographically smaller userId goes first (lower position wins).
 * This guarantees every client converges to the same final document regardless
 * of the order messages arrive.
 */

export function transform(op1, op2) {
  if (!op1 || !op2) return op1;
  if (op1.type === 'insert' && op2.type === 'insert') return _ii(op1, op2);
  if (op1.type === 'insert' && op2.type === 'delete') return _id(op1, op2);
  if (op1.type === 'delete' && op2.type === 'insert') return _di(op1, op2);
  if (op1.type === 'delete' && op2.type === 'delete') return _dd(op1, op2);
  return op1;
}

// ── insert vs insert ─────────────────────────────────────────────────────────
function _ii(op1, op2) {
  if (op2.position < op1.position) {
    return { ...op1, position: op1.position + op2.content.length };
  }
  if (op2.position === op1.position) {
    // Tie-break: lower userId goes first (gets lower position in the doc).
    // If op2.userId wins (≤ op1.userId), op2 was "placed first" so op1 shifts right.
    const u1 = op1.userId ?? '';
    const u2 = op2.userId ?? '';
    if (u2 <= u1) {
      return { ...op1, position: op1.position + op2.content.length };
    }
  }
  return op1;
}

// ── insert vs delete ─────────────────────────────────────────────────────────
function _id(insert, del) {
  const delEnd = del.position + del.length;

  if (del.position >= insert.position) {
    // Delete is entirely at or after insert — position unchanged
    return insert;
  }
  if (delEnd <= insert.position) {
    // Delete is entirely before insert — shift insert left by deleted length
    return { ...insert, position: insert.position - del.length };
  }
  // Insert falls inside the deleted range.
  // "Delete wins" — the insertion is discarded so both concurrent paths
  // converge to the same document.  Returning null signals a no-op.
  return null;
}

// ── delete vs insert ─────────────────────────────────────────────────────────
function _di(del, insert) {
  const delEnd = del.position + del.length;

  if (insert.position <= del.position) {
    // Insert is before (or exactly at) the delete start — shift delete right
    return { ...del, position: del.position + insert.content.length };
  }
  if (insert.position >= delEnd) {
    // Insert is entirely after the delete range — no change
    return del;
  }
  // Insert is inside the deleted range — "delete wins": extend to swallow the insertion
  return { ...del, length: del.length + insert.content.length };
}

// ── delete vs delete ─────────────────────────────────────────────────────────
function _dd(op1, op2) {
  const op1End = op1.position + op1.length;
  const op2End = op2.position + op2.length;

  if (op2End <= op1.position) {
    // op2 is entirely before op1 — shift op1 left
    return { ...op1, position: op1.position - op2.length };
  }
  if (op2.position >= op1End) {
    // op2 is entirely after op1 — no change
    return op1;
  }

  // Ranges overlap — trim op1 to skip characters op2 already deleted
  const overlapStart = Math.max(op1.position, op2.position);
  const overlapEnd   = Math.min(op1End, op2End);
  const overlap      = overlapEnd - overlapStart;
  const newLength    = op1.length - overlap;

  if (newLength <= 0) return null; // op1 is entirely covered — no-op

  // If op2 started before op1, the surviving content of op1 is now at op2.position
  const newPosition = op2.position < op1.position ? op2.position : op1.position;
  return { ...op1, position: newPosition, length: newLength };
}

// ── Apply ─────────────────────────────────────────────────────────────────────

export function applyOp(content, op) {
  if (!op) return content;
  if (op.type === 'insert') {
    return content.slice(0, op.position) + op.content + content.slice(op.position);
  }
  if (op.type === 'delete') {
    return content.slice(0, op.position) + content.slice(op.position + op.length);
  }
  return content;
}

// ── History transform ─────────────────────────────────────────────────────────

/**
 * Transform op against every operation in history (oldest-first).
 * Returns the adjusted op that can be applied on top of the current state,
 * or null if it became a no-op.
 */
export function transformAgainstHistory(op, history) {
  let cur = op;
  for (const h of history) {
    if (!cur) return null;
    cur = transform(cur, h);
  }
  return cur;
}

// ── Compose ───────────────────────────────────────────────────────────────────

/**
 * Attempt to merge two sequential operations from the same user into one.
 * Returns the composed operation, or null if they cannot be merged.
 *
 * Used to compress rapid-fire keystrokes before broadcasting, reducing
 * network chatter and history growth.
 */
export function compose(op1, op2) {
  if (op1.type === 'insert' && op2.type === 'insert') {
    // Append: "Hello" + " world" at adjacent position
    if (op2.position === op1.position + op1.content.length) {
      return { ...op1, content: op1.content + op2.content };
    }
    // Prepend: new insert at same start position
    if (op2.position === op1.position) {
      return { ...op1, content: op2.content + op1.content };
    }
  }

  if (op1.type === 'delete' && op2.type === 'delete') {
    // Forward delete: same start position, grows rightward
    if (op2.position === op1.position) {
      return { ...op1, length: op1.length + op2.length };
    }
    // Backspace: op2 deletes the character just before op1's start
    if (op2.position + op2.length === op1.position) {
      return { ...op2, length: op1.length + op2.length };
    }
  }

  return null; // cannot compose
}
