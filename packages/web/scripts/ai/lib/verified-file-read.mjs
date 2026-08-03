import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function sameFileState(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function canonicalizePlatformPath(candidate) {
  const absolute = path.resolve(candidate);
  const temporaryRoot = path.resolve(os.tmpdir());
  return pathInside(absolute, temporaryRoot)
    ? path.join(fs.realpathSync(temporaryRoot), path.relative(temporaryRoot, absolute))
    : absolute;
}

function compareUnicodeCodePoints(leftValue, rightValue) {
  const left = Array.from(String(leftValue), (value) => value.codePointAt(0));
  const right = Array.from(String(rightValue), (value) => value.codePointAt(0));
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return left.length - right.length;
}

export function readBoundedDirectoryEntries({ directory, maxEntries, label = 'Directory' }) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
    throw new TypeError(`${label} maxEntries must be a non-negative safe integer.`);
  }
  const handle = fs.opendirSync(directory);
  const entries = [];
  try {
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      entries.push(entry);
      if (entries.length > maxEntries) {
        throw new Error(`${label} limit of ${maxEntries} entries exceeded.`);
      }
    }
  } finally {
    handle.closeSync();
  }
  return entries.sort((left, right) => compareUnicodeCodePoints(left.name, right.name));
}

function rejectSymlinkedDirectoryComponents(directory, label) {
  const parsed = path.parse(directory);
  let cursor = parsed.root;
  for (const segment of directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${label} must not contain symbolic links: ${cursor}`);
    }
  }
}

export function verifiedDirectory(rootPath, label = 'Directory') {
  const resolved = canonicalizePlatformPath(rootPath);
  rejectSymlinkedDirectoryComponents(resolved, label);
  return { resolved, real: fs.realpathSync(resolved) };
}

export function ensureVerifiedDirectory(rootPath, label = 'Directory', mode = 0o700) {
  const resolved = canonicalizePlatformPath(rootPath);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} must not contain symbolic links: ${cursor}`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        fs.mkdirSync(cursor, { mode });
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      }
      const created = fs.lstatSync(cursor);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error(`${label} must not contain symbolic links: ${cursor}`);
      }
    }
  }
  return { resolved, real: fs.realpathSync(resolved) };
}

function verifyDescendantPath(root, filePath, label) {
  const resolvedFile = canonicalizePlatformPath(filePath);
  if (!pathInside(resolvedFile, root.resolved) || resolvedFile === root.resolved) {
    throw new Error(`${label} must stay inside ${root.resolved}: ${resolvedFile}`);
  }
  const relative = path.relative(root.resolved, path.dirname(resolvedFile));
  let current = root.resolved;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${label} ancestor must be a real non-symlink directory: ${current}`);
    }
  }
  const realFile = fs.realpathSync(resolvedFile);
  if (!pathInside(realFile, root.real)) {
    throw new Error(`${label} resolves outside its trusted root: ${resolvedFile}`);
  }
  return resolvedFile;
}

export function readVerifiedFile({
  filePath,
  rootPath,
  maxBytes,
  captureBytes = maxBytes,
  label = 'File'
}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError(`${label} maxBytes must be a positive safe integer.`);
  if (!Number.isSafeInteger(captureBytes) || captureBytes < 0 || captureBytes > maxBytes) {
    throw new TypeError(`${label} captureBytes must be a safe integer between zero and maxBytes.`);
  }
  const root = verifiedDirectory(rootPath, `${label} root`);
  const resolvedFile = verifyDescendantPath(root, filePath, label);
  const before = fs.lstatSync(resolvedFile);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file: ${resolvedFile}`);
  }
  if (before.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte size limit: ${resolvedFile}`);
  }

  const descriptor = fs.openSync(resolvedFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || !sameFileState(opened, before)) {
      throw new Error(`${label} changed while it was opened: ${resolvedFile}`);
    }
    const captured = Buffer.alloc(Math.min(opened.size, captureBytes));
    const chunk = Buffer.alloc(Math.min(64 * 1024, Math.max(1, opened.size)));
    const hash = crypto.createHash('sha256');
    let totalRead = 0;
    let capturedBytes = 0;
    while (totalRead < opened.size) {
      const wanted = Math.min(chunk.length, opened.size - totalRead);
      const bytesRead = fs.readSync(descriptor, chunk, 0, wanted, null);
      if (bytesRead === 0) break;
      const bytes = chunk.subarray(0, bytesRead);
      hash.update(bytes);
      if (capturedBytes < captured.length) {
        const copied = Math.min(bytesRead, captured.length - capturedBytes);
        bytes.copy(captured, capturedBytes, 0, copied);
        capturedBytes += copied;
      }
      totalRead += bytesRead;
    }
    if (totalRead !== opened.size) throw new Error(`${label} changed while it was read: ${resolvedFile}`);

    const after = fs.fstatSync(descriptor);
    const current = fs.lstatSync(resolvedFile);
    const finalRealPath = fs.realpathSync(resolvedFile);
    if (!after.isFile() || current.isSymbolicLink() || !current.isFile()
      || !sameFileState(after, opened) || !sameFileState(current, opened)
      || !pathInside(finalRealPath, root.real)) {
      throw new Error(`${label} changed while its verified contents were captured: ${resolvedFile}`);
    }
    return Object.freeze({
      content: captured.toString('utf8'),
      size: opened.size,
      mtimeMs: opened.mtimeMs,
      truncated: opened.size > captured.length,
      sha256: hash.digest('hex')
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readVerifiedJsonFile({
  filePath,
  rootPath = path.dirname(filePath),
  maxBytes,
  label = 'JSON file'
}) {
  const verified = readVerifiedFile({
    filePath,
    rootPath,
    maxBytes,
    captureBytes: maxBytes,
    label
  });
  return JSON.parse(verified.content);
}
