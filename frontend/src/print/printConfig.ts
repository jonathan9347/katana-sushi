export const PAPER_WIDTH_MM = 58;
export const PRINTABLE_WIDTH_MM = 48;
export const SIDE_PADDING_MM = 5;
export const TOP_PADDING_MM = 6;
export const FEED_MM = 25;
export const MIN_HEIGHT_MM = 120;
export const LOGO_WIDTH_PX = 384;
export const INVERSE_BLOCKS = true;
export const USE_DRAWN_LOGO = false;
export const DEFAULT_RECEIPT_PAPER_SIZE = "58mm";

export type PrintProfile = {
  paperWidthMm: number;
  printableWidthMm: number;
  sidePaddingMm: number;
  topPaddingMm: number;
  feedMm: number;
  minHeightMm: number;
  logoWidthPx: number;
  inverseBlocks: boolean;
};

const profiles: Record<string, PrintProfile> = {
  "58mm": {
    paperWidthMm: PAPER_WIDTH_MM,
    printableWidthMm: PRINTABLE_WIDTH_MM,
    sidePaddingMm: SIDE_PADDING_MM,
    topPaddingMm: TOP_PADDING_MM,
    feedMm: FEED_MM,
    minHeightMm: MIN_HEIGHT_MM,
    logoWidthPx: LOGO_WIDTH_PX,
    inverseBlocks: INVERSE_BLOCKS
  },
  "80mm": {
    paperWidthMm: 80,
    printableWidthMm: 72,
    sidePaddingMm: 4,
    topPaddingMm: TOP_PADDING_MM,
    feedMm: FEED_MM,
    minHeightMm: MIN_HEIGHT_MM,
    logoWidthPx: 576,
    inverseBlocks: INVERSE_BLOCKS
  },
  A4: {
    paperWidthMm: 210,
    printableWidthMm: 200,
    sidePaddingMm: 5,
    topPaddingMm: TOP_PADDING_MM,
    feedMm: FEED_MM,
    minHeightMm: MIN_HEIGHT_MM,
    logoWidthPx: 576,
    inverseBlocks: INVERSE_BLOCKS
  }
};

export function getPrintProfile(paperSize = "58mm") {
  const profile = profiles[paperSize];
  if (!profile) {
    throw new Error(`Unsupported receipt paper size: ${paperSize}`);
  }
  return profile;
}
