import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const outputPath = join(root, "THIRD-PARTY-LICENSES.txt");
const checkOnly = process.argv.includes("--check");
const licensePattern = /^(licen[sc]e|copying|notice)(\..+)?$/i;
const packages = new Map();
const requiredDirectNotices = Object.keys(packageJson.dependencies ?? {});

function assertCommercialMetadata() {
	const errors = [];
	const rootLock = lock.packages?.[""] ?? {};
	const proprietaryLicense = readFileSync(join(root, "LICENSE"), "utf8");
	const notices = readFileSync(join(root, "THIRD-PARTY-NOTICES.md"), "utf8");

	if (packageJson.license !== "UNLICENSED" || packageJson.private !== true) {
		errors.push("package.json must remain private with license=UNLICENSED.");
	}
	if (rootLock.license !== "UNLICENSED") {
		errors.push("package-lock.json root license must remain UNLICENSED.");
	}
	if (
		!proprietaryLicense.includes("TALOS PROPRIETARY SOFTWARE LICENSE") ||
		!proprietaryLicense.includes("THIRD-PARTY-NOTICES.md")
	) {
		errors.push("Root LICENSE is missing the proprietary boundary or third-party carve-out.");
	}
	for (const dependency of requiredDirectNotices) {
		if (!notices.includes(`\`${dependency}\``)) {
			errors.push(`THIRD-PARTY-NOTICES.md is missing ${dependency}.`);
		}
	}
	if (!notices.includes("Claudian") || !notices.includes("MIT License")) {
		errors.push("Claudian attribution or MIT text is missing.");
	}
	if (errors.length > 0) {
		for (const error of errors) console.error(error);
		process.exit(1);
	}
}

assertCommercialMetadata();

for (const [relativePath, lockEntry] of Object.entries(lock.packages ?? {})) {
	if (!relativePath.startsWith("node_modules/") || lockEntry.dev === true) continue;
	const packageDir = join(root, relativePath);
	const packageJsonPath = join(packageDir, "package.json");
	if (!existsSync(packageJsonPath)) continue;

	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	const name = packageJson.name;
	const version = packageJson.version ?? lockEntry.version ?? "unknown";
	if (!name) continue;
	const key = `${name}@${version}`;
	if (packages.has(key)) continue;

	const licenseFiles = readdirSync(packageDir)
		.filter((file) => licensePattern.test(file))
		.sort((a, b) => a.localeCompare(b));
	const licenseTexts = licenseFiles.map((file) => ({
		file,
		text: readFileSync(join(packageDir, file), "utf8").trim(),
	}));

	packages.set(key, {
		name,
		version,
		license: packageJson.license ?? lockEntry.license ?? "UNKNOWN",
		repository:
			typeof packageJson.repository === "string"
				? packageJson.repository
				: packageJson.repository?.url ?? "",
		licenseTexts,
	});
}

const sections = [
	"TALOS THIRD-PARTY LICENSE BUNDLE",
	"",
	"This file is generated from package-lock.json and installed production packages.",
	"Do not edit manually. Run `npm run licenses:generate` after dependency changes.",
	"",
];

for (const item of [...packages.values()].sort((a, b) =>
	a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
)) {
	sections.push("=".repeat(78));
	sections.push(`${item.name}@${item.version}`);
	sections.push(`Declared license: ${item.license}`);
	if (item.repository) sections.push(`Repository: ${item.repository}`);
	sections.push("");

	if (item.licenseTexts.length === 0) {
		sections.push(
			"No standalone license file was present in the installed package. " +
				"Consult the package metadata and upstream repository before redistribution."
		);
		sections.push("");
		continue;
	}

	for (const licenseFile of item.licenseTexts) {
		sections.push(`--- ${licenseFile.file} ---`);
		sections.push(licenseFile.text);
		sections.push("");
	}
}

const generated = `${sections.join("\n").trim()}\n`;

if (checkOnly) {
	if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== generated) {
		console.error(
			"THIRD-PARTY-LICENSES.txt is missing or stale. Run `npm run licenses:generate`."
		);
		process.exit(1);
	}
	console.log(`Third-party license audit passed (${packages.size} production packages).`);
} else {
	writeFileSync(outputPath, generated);
	console.log(`Generated THIRD-PARTY-LICENSES.txt (${packages.size} production packages).`);
}
