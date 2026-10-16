import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: npm run version:set -- <MAJOR.MINOR.PATCH[-prerelease]>');
  process.exit(1);
}

function replaceVersion(relativePath, count = 1) {
  const file = path.join(root, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  let replacements = 0;
  const updated = source.replace(/("version"\s*:\s*")[^"]+(")/g, (match, prefix, suffix) => {
    if (replacements >= count) return match;
    replacements += 1;
    return `${prefix}${version}${suffix}`;
  });
  if (replacements !== count) {
    throw new Error(`Could not find ${count} version field(s) in ${relativePath}`);
  }
  fs.writeFileSync(file, updated);
}

replaceVersion('package.json');
replaceVersion('package-lock.json', 2);
replaceVersion('src-tauri/tauri.conf.json');

const cargoTomlFile = path.join(root, 'src-tauri', 'Cargo.toml');
const cargoToml = fs.readFileSync(cargoTomlFile, 'utf8');
const cargoTomlPattern = /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m;
if (!cargoTomlPattern.test(cargoToml)) {
  throw new Error('Could not find [package].version in src-tauri/Cargo.toml');
}
fs.writeFileSync(cargoTomlFile, cargoToml.replace(cargoTomlPattern, `$1${version}$2`));

const cargoLockFile = path.join(root, 'src-tauri', 'Cargo.lock');
const cargoLock = fs.readFileSync(cargoLockFile, 'utf8');
const cargoLockPattern = /(name\s*=\s*"five-d-mind"\r?\nversion\s*=\s*")[^"]+(")/;
if (!cargoLockPattern.test(cargoLock)) {
  throw new Error('Could not find five-d-mind package in src-tauri/Cargo.lock');
}
fs.writeFileSync(cargoLockFile, cargoLock.replace(cargoLockPattern, `$1${version}$2`));

console.log(`Updated application version to ${version}`);
