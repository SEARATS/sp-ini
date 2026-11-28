const resourceFlags = {NONE:0, DISABLE_CACHING:1, CORRECT_OBJ_ORIENTATION:2};

/** Sea Power keeps loose OBJ coordinates by default. Three.js reflects that Unity X axis. */
export function modelResourcePath(value:string) {
  const [file,...tokens] = value.split(",").map(token=>token.trim());
  let flags = 0;
  if (tokens.length === 1 && /^[+-]?\d+$/.test(tokens[0])) {
    const numeric = Number(tokens[0]);
    if (numeric >= -32768 && numeric <= 32767) flags = numeric;
  } else if (tokens.every(token=>Object.hasOwn(resourceFlags,token))) {
    for (const token of tokens) flags |= resourceFlags[token];
  }
  return {file, mirrorObjX:/\.obj$/i.test(file) && !(flags & resourceFlags.CORRECT_OBJ_ORIENTATION)};
}
