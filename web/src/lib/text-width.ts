/**
 * Canvas-measured text width, in the app's own font.
 *
 * One shared context rather than one per call site; the fallback estimate
 * covers environments without canvas, like the test runner's jsdom.
 */
let context: CanvasRenderingContext2D | null = null;

export function textWidth(text: string, sizeAndWeight: string): number {
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) return text.length * 8;
  context.font = `${sizeAndWeight} ${getComputedStyle(document.body).fontFamily}`;
  return context.measureText(text).width;
}
