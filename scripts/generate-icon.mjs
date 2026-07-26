import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const iconSource = path.resolve("assets/app-icon.svg");
const iconOutput = path.resolve("assets/app-icon.png");

async function generateIcon() {
  await sharp(iconSource).resize(256, 256).png().toFile(iconOutput);
}

void generateIcon()
  .then(() => {
    if (!fs.existsSync(iconOutput)) {
      throw new Error("The Folio PNG icon was not generated.");
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
