/**
 * The statement is always mounted but hidden until it is printed, and a browser does not fetch
 * a webfont for a `display: none` subtree. `document.fonts.ready` on its own therefore resolves
 * immediately and the PDF lands in a fallback face, so each face has to be requested by name
 * before the print dialog opens.
 */
export async function warmStatementFonts() {
  if (!document.fonts) return;

  const specs = [
    "400 16px Newsreader",
    "600 16px Newsreader",
    '400 16px "IBM Plex Sans"',
    '600 16px "IBM Plex Sans"',
  ];

  try {
    await Promise.all(specs.map((spec) => document.fonts.load(spec)));
    await document.fonts.ready;
  } catch {
    // A browser without the Font Loading API still prints; it just may not use the intended faces.
  }
}
