import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repositoryRoot, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const failures = [];
const generatedPrefixes = [".next/", "coverage/", "node_modules/", "out/"];
const secretSignatures = [
  ["private key material", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ["live or test credential", /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/],
];
const sensitiveWords = ["SECRET", "TOKEN", "PASSWORD", "PRIVATE_KEY", "API_KEY"];
const publicSensitiveName = new RegExp(`NEXT_PUBLIC_[A-Z0-9_]*(?:${sensitiveWords.join("|")})`);

for (const file of listedFiles) {
  const normalizedFile = file.replaceAll(path.sep, "/");

  if (generatedPrefixes.some((prefix) => normalizedFile.startsWith(prefix))) {
    failures.push(`${normalizedFile}: generated output must not be committed`);
    continue;
  }

  const basename = path.posix.basename(normalizedFile);
  if (basename.startsWith(".env") && normalizedFile !== ".env.example") {
    failures.push(`${normalizedFile}: environment files must not be committed`);
    continue;
  }

  const contents = readFileSync(path.join(repositoryRoot, file));
  if (contents.includes(0) || contents.byteLength > 1_000_000) {
    continue;
  }

  const text = contents.toString("utf8");
  if (normalizedFile === ".env.example") {
    const invalidTemplateLine = text
      .split(/\r?\n/)
      .find((line) => line.length > 0 && !/^[A-Z][A-Z0-9_]*=$/.test(line));

    if (invalidTemplateLine !== undefined) {
      failures.push(`${normalizedFile}: template must contain variable names with empty values only`);
    }
  }

  if (publicSensitiveName.test(text)) {
    failures.push(`${normalizedFile}: secret-like name uses the public client prefix`);
  }

  for (const [label, pattern] of secretSignatures) {
    if (pattern.test(text)) {
      failures.push(`${normalizedFile}: possible ${label}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Repository hygiene check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Repository hygiene check passed (${listedFiles.length} files inspected).`);
