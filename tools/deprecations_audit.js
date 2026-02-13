const { execSync } = require('child_process');

const DEPRECATED_TARGETS = [
  {
    key: '/api/_analyze-vision',
    description: 'Legacy analyze-vision route contract'
  }
];

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (err && typeof err.stdout === 'string') return err.stdout.trim();
    return '';
  }
}

function lines(text) {
  return text ? text.split(/\r?\n/).filter(Boolean) : [];
}

function scanTarget(target) {
  // Where calls still exist (frontend/tests/docs)
  const callHits = lines(run(`rg -n "${target.key}" client public tests *.md tools`));
  // Where route is implemented (backend)
  const routeHits = lines(run(`rg -n "app\\.(get|post|put|delete|patch)\\('/api/_analyze-vision'" index.js`));

  return { callHits, routeHits };
}

function main() {
  console.log('== Deprecation Audit ==');
  let hasIssue = false;

  for (const target of DEPRECATED_TARGETS) {
    const { callHits, routeHits } = scanTarget(target);

    console.log(`\nTarget: ${target.key}`);
    console.log(`Description: ${target.description}`);
    console.log(`Route Definitions: ${routeHits.length}`);
    console.log(`Call-Site References: ${callHits.length}`);

    if (routeHits.length === 0 && callHits.length > 0) {
      hasIssue = true;
      console.log('Status: BROKEN (called but not implemented)');
    } else if (routeHits.length > 0 && callHits.length === 0) {
      hasIssue = true;
      console.log('Status: ORPHAN (implemented but no callers)');
    } else if (routeHits.length > 0 && callHits.length > 0) {
      console.log('Status: ACTIVE LEGACY (still wired)');
    } else {
      console.log('Status: FULLY REMOVED');
    }

    if (callHits.length > 0) {
      console.log('Call-sites:');
      callHits.forEach((h) => console.log(`  - ${h}`));
    }
    if (routeHits.length > 0) {
      console.log('Route definitions:');
      routeHits.forEach((h) => console.log(`  - ${h}`));
    }
  }

  console.log('\n== Summary ==');
  if (hasIssue) {
    console.log('Found deprecation issues that need cleanup.');
    process.exitCode = 1;
    return;
  }
  console.log('No deprecation issues found.');
}

main();

