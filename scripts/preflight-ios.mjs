import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboardRoot = path.join(repoRoot, 'artifacts/corvlio-field-dashboard');
const outputRoot = path.join(dashboardRoot, 'dist/public');
const outputIndex = path.join(outputRoot, 'index.html');
const iosProjectRoot = path.join(dashboardRoot, 'ios/App');
const clerkKey = process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
const failures = [];

function fail(message) {
  failures.push(message);
}

async function validateNativeDeploymentTarget() {
  const [podfile, xcodeProject, capacitorConfig, releaseChecklist, infoPlist, appDelegate] = await Promise.all([
    readFile(path.join(iosProjectRoot, 'Podfile'), 'utf8').catch(() => ''),
    readFile(path.join(iosProjectRoot, 'App.xcodeproj/project.pbxproj'), 'utf8').catch(() => ''),
    readFile(path.join(dashboardRoot, 'capacitor.config.ts'), 'utf8').catch(() => ''),
    readFile(path.join(repoRoot, 'RELEASE_CHECKLIST.md'), 'utf8').catch(() => ''),
    readFile(path.join(iosProjectRoot, 'App/Info.plist'), 'utf8').catch(() => ''),
    readFile(path.join(iosProjectRoot, 'App/AppDelegate.swift'), 'utf8').catch(() => ''),
  ]);
  const xcodeTargets = [...xcodeProject.matchAll(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*([0-9.]+)\s*;/g)]
    .map(([, version]) => version);
  const ok = /platform\s+:ios,\s*['"]17\.0['"]/.test(podfile)
    && xcodeTargets.length > 0
    && xcodeTargets.every((version) => version === '17.0')
    && /IOS_MINIMUM_DEPLOYMENT_TARGET\s*=\s*['"]17\.0['"]/.test(capacitorConfig)
    && /iOS 17\.0/.test(releaseChecklist)
    && /ClerkKit/.test(xcodeProject)
    && /ClerkNativeAuthPlugin\.swift/.test(xcodeProject)
    && /ClerkNativeAuthPlugin\(\)/.test(appDelegate)
    && /<string>com\.corvlio\.fielddashboard<\/string>/.test(infoPlist);
  if (ok) {
    console.log('PASS iOS 17 target, ClerkKit linkage, plugin registration, and callback scheme are configured.');
  } else {
    fail('Native iOS setup must require iOS 17.0 and link/register ClerkKit with the com.corvlio.fielddashboard callback scheme.');
  }
}

function clerkKeyPrefix(value, kind) {
  if (typeof value !== 'string') return null;
  if (kind === 'publishable') {
    if (value.startsWith('pk_live_')) return 'pk_live';
    if (value.startsWith('pk_test_')) return 'pk_test';
    return null;
  }
  if (value.startsWith('sk_live_')) return 'sk_live';
  if (value.startsWith('sk_test_')) return 'sk_test';
  return null;
}

function isProductionClerkConfigured() {
  return clerkKeyPrefix(process.env.CLERK_PUBLISHABLE_KEY, 'publishable') === 'pk_live'
    || clerkKeyPrefix(process.env.CLERK_SECRET_KEY, 'secret') === 'sk_live'
    || /^https:\/\/clerk\./i.test(process.env.CLERK_FRONTEND_API_URL?.trim() ?? '');
}

async function collectFiles(entry) {
  let info;
  try {
    info = await stat(entry);
  } catch {
    return [];
  }
  if (info.isFile()) return [entry];
  if (!info.isDirectory()) return [];

  const files = [];
  for (const child of await readdir(entry, { withFileTypes: true })) {
    if (child.name === 'node_modules' || child.name === 'dist' || child.name === '.git') continue;
    const childPath = path.join(entry, child.name);
    if (child.isDirectory()) files.push(...await collectFiles(childPath));
    else if (child.isFile()) files.push(childPath);
  }
  return files;
}

function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

async function inspectReferencedBundleGraph(entryPath, expectedKey, visited = new Set()) {
  if (visited.has(entryPath)) return { containsExpectedKey: false, keyPrefixes: new Set() };
  visited.add(entryPath);

  let bundle;
  try {
    bundle = await readFile(entryPath, 'utf8');
  } catch {
    return { containsExpectedKey: false, keyPrefixes: new Set() };
  }
  const keyPrefixes = new Set(
    [...bundle.matchAll(/\b(pk_(?:test|live)_[A-Za-z0-9_-]+)/g)]
      .map(([key]) => key.startsWith('pk_live_') ? 'pk_live' : 'pk_test'),
  );
  let containsExpectedKey = bundle.includes(expectedKey);

  const imports = [...bundle.matchAll(/(?:import\s*\(\s*|from\s*)["']([^"']+\.js(?:\?[^"']*)?)["']/g)]
    .map((match) => match[1]);
  for (const specifier of imports) {
    let importedPath;
    try {
      const pathname = decodeURIComponent(new URL(specifier, `file://${entryPath}`).pathname);
      importedPath = path.resolve(path.dirname(entryPath), specifier.startsWith('/')
        ? `.${pathname}`
        : pathname);
    } catch {
      continue;
    }
    if (!importedPath.startsWith(`${outputRoot}${path.sep}`)) continue;
    const child = await inspectReferencedBundleGraph(importedPath, expectedKey, visited);
    containsExpectedKey ||= child.containsExpectedKey;
    for (const prefix of child.keyPrefixes) keyPrefixes.add(prefix);
  }
  return { containsExpectedKey, keyPrefixes };
}

if (!clerkKey) {
  fail('VITE_CLERK_PUBLISHABLE_KEY is missing or empty. Add it to Replit Secrets, then rebuild the iOS web assets.');
} else {
  console.log('PASS Clerk publishable key is configured (value not displayed).');
  const prefix = clerkKeyPrefix(clerkKey, 'publishable');
  if (!prefix) {
    fail('VITE_CLERK_PUBLISHABLE_KEY must start with pk_live_ or pk_test_. The key value was not displayed.');
  } else {
    console.log(`Clerk iOS key prefix: ${prefix}.`);
  }
}

await validateNativeDeploymentTarget();

let indexInfo;
let html = '';
try {
  indexInfo = await stat(outputIndex);
  html = await readFile(outputIndex, 'utf8');
} catch {
  fail('Production web build is missing: artifacts/corvlio-field-dashboard/dist/public/index.html. Run the native production build first.');
}

const sourceEntries = [
  path.join(dashboardRoot, 'src'),
  path.join(dashboardRoot, 'public'),
  path.join(repoRoot, 'lib/api-client-react/src'),
  path.join(repoRoot, 'lib/api-zod/src'),
  path.join(dashboardRoot, 'index.html'),
  path.join(dashboardRoot, 'vite.config.ts'),
  path.join(dashboardRoot, 'security-policy.mjs'),
  path.join(dashboardRoot, 'package.json'),
  path.join(repoRoot, 'package.json'),
  path.join(repoRoot, 'pnpm-lock.yaml'),
];
const sourceFiles = (await Promise.all(sourceEntries.map(collectFiles))).flat();
let latestSourceTime = 0;
for (const sourceFile of sourceFiles) {
  try {
    latestSourceTime = Math.max(latestSourceTime, (await stat(sourceFile)).mtimeMs);
  } catch {
    // A source file can disappear between discovery and stat; a fresh build still wins.
  }
}
if (indexInfo && latestSourceTime > indexInfo.mtimeMs + 1000) {
  fail('Production web build is older than the latest app source change. Rebuild before syncing Capacitor.');
} else if (indexInfo) {
  console.log('PASS Production web build exists and is current with source files.');
}

if (html) {
  const moduleScripts = [...html.matchAll(/<script\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => getAttribute(tag, 'type')?.toLowerCase() === 'module')
    .map((tag) => getAttribute(tag, 'src'))
    .filter((src) => typeof src === 'string' && src.length > 0);
  const resolvedEntries = [];
    for (const src of moduleScripts) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(src, 'https://preflight.invalid').pathname);
    } catch {
      continue;
    }
    const assetPath = path.resolve(outputRoot, `.${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
    if (!assetPath.startsWith(`${outputRoot}${path.sep}`)) continue;
    try {
      if ((await stat(assetPath)).isFile()) resolvedEntries.push(assetPath);
    } catch {
      // Report one actionable bundle error below.
    }
  }

  if (resolvedEntries.length === 0) {
    fail('dist/public/index.html does not reference an existing JavaScript module bundle. Rebuild before syncing Capacitor.');
  } else {
    console.log('PASS dist/public/index.html references an existing JavaScript module bundle.');
  }

  if (clerkKey) {
    const bundleChecks = await Promise.all(
      resolvedEntries.map((entry) => inspectReferencedBundleGraph(entry, clerkKey)),
    );
    const keyInBundleGraph = bundleChecks.some((result) => result.containsExpectedKey);
    const bundleKeyPrefixes = new Set(bundleChecks.flatMap((result) => [...result.keyPrefixes]));
    if (isProductionClerkConfigured() && bundleKeyPrefixes.has('pk_test')) {
      fail('The iOS bundle contains a development Clerk key (pk_test), but production Clerk is configured. Set VITE_CLERK_PUBLISHABLE_KEY to the matching production key and rebuild before syncing.');
    }
    if (!keyInBundleGraph) {
      fail('The Clerk key is not present in the JavaScript bundle graph referenced by index.html. Rebuild with the correct VITE_CLERK_PUBLISHABLE_KEY.');
    } else {
      console.log('PASS The JavaScript bundle graph referenced by index.html contains the configured Clerk key (value not displayed).');
    }
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error('iOS preflight failed. Run the native production build, then run pnpm run preflight:ios again.');
  process.exitCode = 1;
} else {
  console.log('iOS preflight passed. It is safe to run Capacitor sync.');
}
