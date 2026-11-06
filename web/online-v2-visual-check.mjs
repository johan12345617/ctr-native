// Test-only pixel check: camera masks and simulation hashes cannot detect an
// opponent's background erasing the local track after its geometry was drawn.
export async function inspectRaceScene(page) {
  const screenshot = await page.locator("#canvas").screenshot();
  return page.evaluate(async png => {
    const image = new Image();
    image.src = "data:image/png;base64," + png;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    // Exclude the left map, right standings/meters and top HUD. A sky gradient
    // has little horizontal detail; a visible road/kart has texture and edges.
    const step = Math.max(2, Math.round(canvas.width / 200));
    let samples = 0, lit = 0, textured = 0;
    for (let y = Math.floor(canvas.height * .42); y < canvas.height * .82; y += step) {
      for (let x = Math.floor(canvas.width * .28); x < canvas.width * .72; x += step) {
        const index = (y * canvas.width + x) * 4, next = index + step * 4;
        samples++;
        if (data[index] + data[index + 1] + data[index + 2] > 60) lit++;
        if (Math.abs(data[index] - data[next]) + Math.abs(data[index + 1] - data[next + 1]) +
            Math.abs(data[index + 2] - data[next + 2]) > 60) textured++;
      }
    }
    return { litRatio: lit / samples, texturedRatio: textured / samples,
      visible: lit / samples > .2 && textured / samples > .02 };
  }, screenshot.toString("base64"));
}
