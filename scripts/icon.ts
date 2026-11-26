import { Resvg } from "@resvg/resvg-js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Draw the lettering as outlines so the icon builds without installed fonts.
const glyphs = {
  S: "M40 17H27V14Q27 10 21 10Q15 10 15 15V17Q15 20 21 23L30 27Q41 32 41 42V44Q41 56 21 56Q1 56 1 42V38H15V42Q15 46 21 46Q27 46 27 42V40Q27 37 21 34L12 30Q1 25 1 16V14Q1 0 21 0Q40 0 40 14Z",
  P: "M0 0H23Q42 0 42 16V21Q42 37 23 37H14V56H0Z M14 11V26H21Q28 26 28 20V17Q28 11 21 11Z",
  I: "M0 0H19V7H15V34H19V41H0V34H4V7H0Z",
  N: "M0 0H11L25 23V0H36V41H25L11 18V41H0Z"
};

export async function generateIcon() {
  const directory = resolve(__dirname, "../dist");
  const letter = (name: keyof typeof glyphs, x: number, y: number) =>
    `    <path transform="translate(${x} ${y})" d="${glyphs[name]}"/>`;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128">',
    '  <title>SP INI</title>',
    '  <rect width="128" height="128" fill="#080808"/>',
    '  <g fill="white" fill-rule="evenodd">',
    letter("S", 17, 6), letter("P", 69, 6),
    letter("I", 18, 68), letter("N", 46, 68), letter("I", 92, 68),
    '  </g>',
    '  <rect y="115" width="128" height="13" fill="#ba2025"/>',
    '</svg>', ''
  ].join("\n");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(resolve(directory, "icon.svg"), svg),
    writeFile(resolve(directory, "icon.png"), new Resvg(svg).render().asPng())
  ]);
}

if (require.main === module) generateIcon().catch(error => { console.error(error); process.exitCode = 1; });
