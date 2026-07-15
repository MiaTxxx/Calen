const requiredVariables = ["TAURI_SIGNING_PRIVATE_KEY", "CALEN_UPDATER_PUBLIC_KEY"];

const missingVariables = requiredVariables.filter(
  (name) => !process.env[name]?.trim(),
);

if (missingVariables.length > 0) {
  console.error(
    `Missing updater signing configuration: ${missingVariables.join(", ")}. ` +
      "Configure the Calen release secrets before building updater artifacts.",
  );
  process.exit(1);
}

console.log("Updater signing configuration is present.");
