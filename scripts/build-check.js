const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('Starting VtuNova Backend build validation...');

const rootDir = path.resolve(__dirname, '..');

function getAllJsFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'scratch') {
        arrayOfFiles = getAllJsFiles(fullPath, arrayOfFiles);
      }
    } else {
      if (file.endsWith('.js')) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

const jsFiles = getAllJsFiles(rootDir);
console.log(`Found ${jsFiles.length} JavaScript files to validate.`);

let errorsCount = 0;

// 1. Syntax Check using vm.Script
for (const file of jsFiles) {
  const relPath = path.relative(rootDir, file);
  try {
    const code = fs.readFileSync(file, 'utf8');
    new vm.Script(code, { filename: relPath });
  } catch (err) {
    console.error(`❌ Syntax Error in ${relPath}: ${err.message}`);
    errorsCount++;
  }
}

// 2. Relative require check
const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const file of jsFiles) {
  const relPath = path.relative(rootDir, file);
  const content = fs.readFileSync(file, 'utf8');

  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    const reqPath = match[1];

    if (reqPath.startsWith('.')) {
      const dir = path.dirname(file);
      let targetPath = path.resolve(dir, reqPath);
      
      let exists = fs.existsSync(targetPath);
      if (!exists && !targetPath.endsWith('.js')) {
        if (fs.existsSync(targetPath + '.js')) {
          exists = true;
        } else if (fs.existsSync(path.join(targetPath, 'index.js'))) {
          exists = true;
        } else if (fs.existsSync(targetPath + '.json')) {
          exists = true;
        }
      }

      if (!exists) {
        console.error(`❌ Missing local import in ${relPath}: require('${reqPath}')`);
        errorsCount++;
      }
    }
  }
}

if (errorsCount > 0) {
  console.error(`\nBuild failed with ${errorsCount} error(s).`);
  process.exit(1);
} else {
  console.log('\n✅ Build validation successful! All JavaScript files passed syntax and link checks.');
  process.exit(0);
}
